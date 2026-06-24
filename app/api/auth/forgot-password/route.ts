/* Public "forgot password" for IT staff. Sends a branded recovery email (via
   SendGrid, not Supabase's default) only if the email belongs to a staff member
   (has a user_roles row). Always returns a generic success so it can't be used to
   probe which addresses have accounts. Service-role key server-side only. */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { siteUrl } from '@/lib/site';
import { resetEmailHtml, resetEmailText } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GENERIC = { ok: true, message: 'If that account exists, we’ve emailed a password reset link.' };

export async function POST(req: NextRequest) {
  const SITE_URL = siteUrl(req);
  const EMAIL_FROM = process.env.EMAIL_FROM!;

  let body: { email?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });

  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Only staff (user_roles row) get a staff-login reset. Find their auth id by email.
  try {
    const { data: au } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const user = (au?.users || []).find(u => (u.email || '').toLowerCase() === email);
    if (user) {
      const { data: role } = await admin.from('user_roles').select('full_name').eq('user_id', user.id).maybeSingle();
      if (role) {
        const { data: gen } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: `${SITE_URL}/set-password` } });
        const link = gen?.properties?.action_link;
        if (link && process.env.SENDGRID_API_KEY) {
          await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              personalizations: [{ to: [{ email, name: role.full_name || '' }] }],
              from: { email: EMAIL_FROM, name: 'HDS IT Helpdesk' },
              subject: 'Reset your HDS IT Helpdesk password',
              content: [
                { type: 'text/plain', value: resetEmailText({ name: String(role.full_name || ''), link }) },
                { type: 'text/html', value: resetEmailHtml({ name: String(role.full_name || ''), link }) },
              ],
            }),
          });
        }
      }
    }
  } catch (err) {
    console.error('forgot-password: error (returning generic anyway)', (err as Error).message);
  }

  // Always generic — never reveal whether the account exists.
  return NextResponse.json(GENERIC);
}
