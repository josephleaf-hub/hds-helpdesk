/* Port of netlify/functions/regenerate-token.js — issues a fresh portable
   token for a requester and emails the /p/{token} link. Bearer JWT (authed
   "new link") OR { email } body (lost-link). Token never logged in full. */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { getSiteUrl } from '@/lib/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_DOMAINS = ['homedelivery.com.au', 'hdsau.com'];

export async function POST(req: NextRequest) {
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const SITE_URL = getSiteUrl();
  const EMAIL_FROM = process.env.EMAIL_FROM || 'helpdesk@homedelivery.com.au';

  // Determine the email: authenticated session first, else request body.
  let email: string | null = null;
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const { data, error } = await admin.auth.getUser(authHeader.slice(7));
    if (!error && data?.user?.email) email = data.user.email.toLowerCase();
  }
  if (!email) {
    let body: { email?: string };
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    email = (body.email || '').toLowerCase().trim();
  }

  if (!email || !email.includes('@')) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  if (!ALLOWED_DOMAINS.includes(email.split('@')[1])) {
    return NextResponse.json({ error: 'Please use your HDS work email' }, { status: 403 });
  }

  // Mint a new token, replacing any existing one for this email.
  const token = crypto.randomBytes(18).toString('base64url');
  const now = new Date().toISOString();
  const { error: upErr } = await admin
    .from('user_access_tokens')
    .upsert({ user_email: email, token, created_at: now, last_used_at: null, revoked_at: null }, { onConflict: 'user_email' });
  if (upErr) {
    console.error('regenerate-token: upsert failed:', upErr.message);
    return NextResponse.json({ error: 'Could not generate a new link' }, { status: 500 });
  }

  try {
    await sendTokenEmail(email, `${SITE_URL}/p/${token}`, EMAIL_FROM);
  } catch (e) {
    console.error('regenerate-token: email send failed:', (e as Error).message);
    return NextResponse.json({ error: 'New link created but the email failed to send' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

async function sendTokenEmail(email: string, link: string, emailFrom: string) {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#0F1C2E;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <tr><td style="padding:24px 28px 16px;border-bottom:1px solid #E2E8EF;">
        <div style="font-size:12px;color:#6B7280;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">HDS IT Helpdesk</div>
        <div style="font-size:18px;font-weight:600;color:#0F1C2E;margin-top:4px;">Your sign-in link</div>
      </td></tr>
      <tr><td style="padding:24px 28px;font-size:14px;line-height:1.6;color:#0F1C2E;">
        <div style="margin-bottom:20px;">Use the button below to sign in to the HDS IT Helpdesk. It works on any device, any time — bookmark it if you like.</div>
        <div style="margin:0 0 20px;"><a href="${link}" style="display:inline-block;background:#1C64F2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">Sign in to the portal</a></div>
        <div style="font-size:12px;color:#6B7280;line-height:1.5;">If you didn't request this, you can ignore it. If you think your previous link was shared, this new one replaces it.</div>
        <div style="margin-top:24px;color:#6B7280;font-size:13px;">— HDS IT Helpdesk</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text = [
    `Your HDS IT Helpdesk sign-in link (works on any device, any time):`,
    link,
    '',
    `If you didn't request this, you can ignore it.`,
    '',
    `— HDS IT Helpdesk`,
  ].join('\n');

  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email }] }],
      from: { email: emailFrom, name: 'HDS IT Helpdesk' },
      subject: 'Your HDS IT Helpdesk sign-in link',
      content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
    }),
  });
  if (!r.ok) throw new Error('SendGrid ' + r.status + ': ' + (await r.text()).slice(0, 200));
}
