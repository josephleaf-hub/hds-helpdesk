/* Port of netlify/functions/submit-ticket.js — creates a ticket (service role),
   stores an optional submission image, emails IT, and emails the requester a
   portable-token sign-in link. Public endpoint (no auth); domain-gated. Links
   use the request origin (preview vs prod). */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { siteUrl } from '@/lib/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_DOMAINS = ['homedelivery.com.au', 'hdsau.com'];
const ATTACH_BUCKET = 'ticket-attachments';
const MAX_IMG_BYTES = 2 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const SITE_URL = siteUrl(req);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const {
    category, subType, priority, subject, description,
    requesterName, requesterEmail, department, location, affectedUser, image,
  } = body as Record<string, string> & { image?: { dataBase64?: string; mimeType?: string; fileName?: string } };

  if (!category || !subType || !priority || !subject || !description || !requesterName || !requesterEmail || !department) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (!requesterEmail.includes('@')) return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
  const emailNorm = requesterEmail.toLowerCase().trim();
  if (!ALLOWED_DOMAINS.includes(emailNorm.split('@')[1])) {
    return NextResponse.json({ error: 'Please use your HDS work email' }, { status: 400 });
  }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const { data: ticketId, error: idError } = await supabase.rpc('next_ticket_id');
  if (idError || !ticketId) {
    console.error('Ticket ID error:', idError);
    return NextResponse.json({ error: 'Failed to generate ticket ID' }, { status: 500 });
  }

  const { error: insertError } = await supabase.from('tickets').insert([{
    id: ticketId, category, sub_type: subType, priority, subject, description,
    requester_name: requesterName, requester_email: emailNorm, department,
    location: location || null, affected_user: affectedUser || null, status: 'new',
  }]);
  if (insertError) {
    console.error('Insert error:', insertError);
    return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 });
  }

  // Optional submission image (non-blocking; ticket-level attachment, note_id null).
  let imageSaved = false;
  if (image && image.dataBase64) {
    try {
      const mime = String(image.mimeType || '');
      if (!mime.startsWith('image/')) throw new Error('Attachment is not an image');
      const buffer = Buffer.from(image.dataBase64, 'base64');
      if (buffer.length > MAX_IMG_BYTES) throw new Error('Image exceeds the 2 MB limit');
      const safeName = String(image.fileName || 'image.jpg').replace(/[^\w.\-]+/g, '_').slice(0, 80);
      const storagePath = `${ticketId}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from(ATTACH_BUCKET).upload(storagePath, buffer, { contentType: mime, upsert: false });
      if (upErr) throw upErr;
      const { error: rowErr } = await supabase.from('ticket_attachments').insert({
        ticket_id: ticketId, note_id: null, storage_path: storagePath, file_name: safeName,
        file_size: buffer.length, mime_type: mime, uploaded_by: requesterName || emailNorm,
      });
      if (rowErr) throw rowErr;
      imageSaved = true;
    } catch (imgErr) {
      console.error('Submission image failed:', (imgErr as Error).message);
    }
  }

  // IT notification (non-blocking).
  try {
    await sendEmail(ticketId, { category, subType, priority, subject, description, requesterName, requesterEmail: emailNorm, department, location, affectedUser }, SITE_URL);
  } catch (emailErr) {
    console.error('IT notification failed:', (emailErr as Error).message);
  }

  // Requester confirmation with a portable-token magic link (non-blocking).
  let confirmationSent = false;
  try {
    const token = await getOrCreateToken(supabase, emailNorm);
    const ticketLink = `${SITE_URL}/p/${token}/t/${ticketId}`;
    const portalLink = `${SITE_URL}/p/${token}`;
    await sendConfirmationEmail(ticketId, { subject, requesterName, requesterEmail: emailNorm }, ticketLink, portalLink, SITE_URL);
    confirmationSent = true;
  } catch (confErr) {
    console.error('Confirmation email failed:', (confErr as Error).message);
  }

  return NextResponse.json({ success: true, ticketId, confirmationSent, imageSaved });
}

// ─────────────────────────────────────────────
// EMAIL TEMPLATE — IT notification
// ─────────────────────────────────────────────
type Ticket = {
  category: string; subType: string; priority: string; subject: string; description: string;
  requesterName: string; requesterEmail: string; department: string; location?: string; affectedUser?: string;
};

async function sendEmail(ticketId: string, ticket: Ticket, SITE_URL: string) {
  const catLabels: Record<string, string> = { access: 'Access Request', hardware: 'Hardware Request', account: 'Account Setup / Offboarding', support: 'General IT Support' };
  const priColors: Record<string, string> = { urgent: '#C0392B', high: '#B45309', medium: '#1C64F2', low: '#6B7280' };
  const priBg: Record<string, string> = { urgent: '#FDECEA', high: '#FEF3C7', medium: '#EBF2FF', low: '#F3F4F6' };
  const color = priColors[ticket.priority] || '#6B7280';
  const bgCol = priBg[ticket.priority] || '#F3F4F6';
  const catStr = catLabels[ticket.category] || ticket.category;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.10);max-width:100%;">
      <tr>
        <td style="background:#060D18;padding:24px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.02em;line-height:1;">HDS IT Helpdesk</div>
                <div style="color:#8A97A8;font-size:12px;margin-top:5px;">New Support Ticket</div>
              </td>
              <td align="right" valign="middle">
                <span style="background:${color};color:#ffffff;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">${ticket.priority}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:#EBF2FF;padding:14px 32px;border-bottom:1px solid #E2E8EF;">
          <span style="font-size:18px;font-weight:700;color:#1C64F2;letter-spacing:-0.02em;">${ticketId}</span>
          <span style="font-size:12px;color:#6B7280;margin-left:10px;">${catStr} — ${ticket.subType}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 32px 6px;">
          <div style="font-size:17px;font-weight:700;color:#0F1C2E;line-height:1.3;">${ticket.subject}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FA;border-radius:8px;border:1px solid #E2E8EF;">
            <tr>
              <td width="50%" style="padding:14px 18px;border-bottom:1px solid #E2E8EF;border-right:1px solid #E2E8EF;vertical-align:top;">
                <div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:5px;">Requester</div>
                <div style="font-size:13px;font-weight:600;color:#0F1C2E;">${ticket.requesterName}</div>
                <div style="font-size:12px;color:#6B7280;margin-top:2px;">${ticket.requesterEmail}</div>
              </td>
              <td width="50%" style="padding:14px 18px;border-bottom:1px solid #E2E8EF;vertical-align:top;">
                <div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:5px;">Department / Location</div>
                <div style="font-size:13px;font-weight:600;color:#0F1C2E;">${ticket.department}${ticket.location ? ' · ' + ticket.location : ''}</div>
              </td>
            </tr>
            ${ticket.affectedUser ? `
            <tr>
              <td colspan="2" style="padding:14px 18px;border-bottom:1px solid #E2E8EF;">
                <div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:5px;">Affected User</div>
                <div style="font-size:13px;font-weight:600;color:#0F1C2E;">${ticket.affectedUser}</div>
              </td>
            </tr>` : ''}
            <tr>
              <td colspan="2" style="padding:14px 18px;">
                <div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Description</div>
                <div style="font-size:13px;color:#0F1C2E;line-height:1.65;">${ticket.description.replace(/\n/g, '<br>')}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:${bgCol};padding:12px 32px;border-top:1px solid #E2E8EF;">
          <span style="color:${color};font-size:12px;font-weight:600;">⚡ Priority: ${ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}</span>
          <span style="color:#6B7280;font-size:12px;margin-left:16px;">Open the <a href="${SITE_URL}/admin" style="color:#1C64F2;font-weight:600;text-decoration:none;">IT Admin Dashboard</a> to manage this ticket.</span>
        </td>
      </tr>
      <tr>
        <td style="background:#F8F9FA;padding:14px 32px;border-top:1px solid #E2E8EF;">
          <div style="font-size:11px;color:#9CA3AF;">This notification was sent by the HDS IT Helpdesk system. Do not reply to this email.</div>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const fromAddr = process.env.EMAIL_FROM || 'helpdesk@homedelivery.com.au';
  const toAddr = process.env.IT_SUPPORT_EMAIL || 'itsupporttickets@hdsau.com.au';

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toAddr }] }],
      from: { email: fromAddr, name: 'HDS IT Helpdesk' },
      subject: `[${ticketId}] [${ticket.priority.toUpperCase()}] ${ticket.subject}`,
      content: [{ type: 'text/html', value: html }],
    }),
  });
  if (!res.ok) throw new Error(`SendGrid API ${res.status}: ${await res.text()}`);
}

// ─────────────────────────────────────────────
// CONFIRMATION EMAIL — to the requester, with a magic link
// ─────────────────────────────────────────────
function escEmail(s: string) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

async function sendConfirmationEmail(
  ticketId: string,
  ticket: { subject: string; requesterName: string; requesterEmail: string },
  magicLink: string, portalLink: string, SITE_URL: string,
) {
  const firstName = (ticket.requesterName || '').split(' ')[0] || 'there';
  const fromAddr = process.env.EMAIL_FROM || 'helpdesk@homedelivery.com.au';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#0F1C2E;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <tr><td align="left" style="padding:20px 28px;background:#fff;border-bottom:1px solid #E2E8EF;">
        <img src="https://cdn.prod.website-files.com/69d48f8f8f01871806e7f641/69e03c21c28ca297a9031891_Teritary-positive.png" alt="HDS" height="32" style="height:32px;width:auto;display:block;border:0;" />
      </td></tr>
      <tr><td style="padding:24px 28px 16px;">
        <div style="font-size:12px;color:#6B7280;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">HDS IT Helpdesk · Ticket ${escEmail(ticketId)}</div>
        <div style="font-size:18px;font-weight:600;color:#0F1C2E;margin-top:4px;">We received your ticket</div>
      </td></tr>
      <tr><td style="padding:24px 28px;font-size:14px;line-height:1.6;color:#0F1C2E;">
        <div style="margin-bottom:16px;">Hi ${escEmail(firstName)},</div>
        <div style="margin-bottom:16px;">We've received your IT ticket and the team has been notified.</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FA;border:1px solid #E2E8EF;border-radius:8px;margin-bottom:20px;">
          <tr><td style="padding:12px 16px;font-size:13px;">
            <div><strong>Title:</strong> ${escEmail(ticket.subject)}</div>
            <div style="margin-top:4px;"><strong>Reference:</strong> ${escEmail(ticketId)}</div>
          </td></tr>
        </table>
        <div style="margin-bottom:20px;">We'll be in touch soon. You can view this ticket and any replies at any time using the button below.</div>
        <div style="margin:0 0 20px;">
          <a href="${magicLink}" style="display:inline-block;background:#1C64F2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">View ticket</a>
          <a href="${portalLink}" style="display:inline-block;margin-left:8px;background:#fff;color:#1C64F2;border:1px solid #C8D4DF;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:8px;">View all my tickets</a>
        </div>
        <div style="font-size:12px;color:#6B7280;line-height:1.5;">This link signs you in automatically. After signing in once, you'll stay logged in for 30 days and can use the portal at <a href="${SITE_URL}" style="color:#1C64F2;">it-helpdesk.hdsaus.com.au</a>.</div>
        <div style="margin-top:24px;color:#6B7280;font-size:13px;">— HDS IT Helpdesk</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text = [
    `Hi ${firstName},`, '',
    `We've received your IT ticket and the team has been notified.`, '',
    `Title: ${ticket.subject}`, `Reference: ${ticketId}`, '',
    `View your ticket (this link signs you in automatically):`, magicLink, '',
    `View all your tickets:`, portalLink, '',
    `After signing in once, you'll stay logged in for 30 days at ${SITE_URL}`, '',
    `— HDS IT Helpdesk`,
  ].join('\n');

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: ticket.requesterEmail, name: ticket.requesterName }] }],
      from: { email: fromAddr, name: 'HDS IT Helpdesk' },
      subject: `We received your IT ticket [${ticketId}]`,
      content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
    }),
  });
  if (!res.ok) throw new Error(`SendGrid API ${res.status}: ${await res.text()}`);
}

// One permanent portable token per requester email.
async function getOrCreateToken(supabase: SupabaseClient, email: string) {
  const { data: existing } = await supabase.from('user_access_tokens').select('token').eq('user_email', email).is('revoked_at', null).maybeSingle();
  if (existing && existing.token) return existing.token;
  const token = crypto.randomBytes(18).toString('base64url');
  const { error } = await supabase.from('user_access_tokens').upsert({ user_email: email, token }, { onConflict: 'user_email' });
  if (error) throw error;
  return token;
}
