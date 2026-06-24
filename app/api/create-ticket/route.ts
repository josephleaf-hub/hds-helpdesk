/* Port of netlify/functions/create-ticket.js — IT staff raise a ticket on
   behalf of a requester. Admin/manager only (Bearer JWT + user_roles).
   next_ticket_id → insert (service role) → optional "request logged" email
   (notify ON by default, non-fatal). Requester email gated to HDS domains. */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { siteUrl } from '@/lib/site';
import { emailLogoImgs, EMAIL_HEAD_STYLE } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUSES = ['new', 'in-progress', 'waiting-on-admin', 'waiting-on-requester', 'on-hold', 'resolved', 'closed'];
const VALID_CATEGORIES = ['access', 'hardware', 'account', 'support'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const ALLOWED_DOMAINS = ['homedelivery.com.au', 'hdsau.com'];

export async function POST(req: NextRequest) {
  const SITE_URL = siteUrl(req);
  const EMAIL_FROM = process.env.EMAIL_FROM!;

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return NextResponse.json({ error: 'Missing or malformed Authorization header' }, { status: 401 });
  const accessToken = authHeader.slice(7);

  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const { data: roleRow, error: roleErr } = await admin.from('user_roles').select('role, department, full_name').eq('user_id', userData.user.id).maybeSingle();
  if (roleErr) return NextResponse.json({ error: 'Role lookup failed: ' + roleErr.message }, { status: 500 });
  if (!roleRow || !['admin', 'manager'].includes(roleRow.role)) return NextResponse.json({ error: 'Account does not have IT staff access' }, { status: 403 });

  let body: Record<string, string | boolean | undefined>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { requesterName, requesterEmail, department, location, affectedUser, subject, category, subType, priority, description, status, assignedTo, notify, sourceThread } = body as Record<string, string> & { notify?: boolean };

  if (!subject || !String(subject).trim()) return NextResponse.json({ error: 'Subject is required' }, { status: 400 });
  if (!requesterName || !String(requesterName).trim()) return NextResponse.json({ error: 'Requester name is required' }, { status: 400 });
  const emailNorm = String(requesterEmail || '').toLowerCase().trim();
  if (!emailNorm || !emailNorm.includes('@')) return NextResponse.json({ error: 'A valid requester email is required' }, { status: 400 });
  if (!ALLOWED_DOMAINS.includes(emailNorm.split('@')[1])) return NextResponse.json({ error: 'Requester email must be an HDS address (@homedelivery.com.au or @hdsau.com)' }, { status: 400 });
  if (!VALID_CATEGORIES.includes(category)) return NextResponse.json({ error: 'A valid category is required' }, { status: 400 });
  if (priority && !VALID_PRIORITIES.includes(priority)) return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });

  const finalStatus = status || 'in-progress';
  if (!VALID_STATUSES.includes(finalStatus)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  const { data: ticketId, error: idErr } = await admin.rpc('next_ticket_id');
  if (idErr || !ticketId) {
    console.error('next_ticket_id failed:', idErr);
    return NextResponse.json({ error: 'Failed to generate ticket ID' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    id: ticketId, category, sub_type: String(subType || '').trim(), priority: priority || 'medium',
    subject: String(subject).trim(), description: String(description || '').trim(),
    requester_name: String(requesterName).trim(), requester_email: emailNorm,
    department: String(department || '').trim(), location: location || null, affected_user: affectedUser || null,
    status: finalStatus, assigned_to: assignedTo || null,
  };
  if (finalStatus === 'resolved' || finalStatus === 'closed') row.resolved_at = now;

  const { error: insErr } = await admin.from('tickets').insert([row]);
  if (insErr) {
    console.error('Ticket insert failed:', insErr);
    return NextResponse.json({ error: 'Failed to create ticket: ' + insErr.message }, { status: 500 });
  }

  // If the ticket was drafted from a pasted email thread, keep the original
  // verbatim as the first note (internal — IT-side record, not shown to the
  // requester in the portal) so the source is never lost. Non-fatal.
  const thread = String(sourceThread || '').trim();
  if (thread) {
    try {
      await admin.from('ticket_notes').insert({
        ticket_id: ticketId, added_by: roleRow.full_name || userData.user.email || 'IT Staff',
        note_text: `Original email thread (pasted at creation):\n\n${thread}`.slice(0, 20000),
        note_type: 'internal',
      });
    } catch (err) {
      console.error('create-ticket: failed to save source thread note:', (err as Error).message);
    }
  }

  let notified = false;
  if (notify !== false) {
    try {
      const token = await getOrCreateToken(admin, emailNorm);
      const link = token ? `${SITE_URL}/p/${token}/t/${ticketId}` : `${SITE_URL}/t/${ticketId}`;
      const ticket = { id: ticketId as string, subject: row.subject as string, requester_name: row.requester_name as string };
      const html = buildCreatedHtml({ ticket, link });
      const text = buildCreatedText({ ticket, link });
      const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: row.requester_email, name: row.requester_name }] }],
          from: { email: EMAIL_FROM, name: 'HDS IT Helpdesk' },
          reply_to: { email: EMAIL_FROM, name: 'HDS IT Helpdesk' },
          subject: `[${ticketId}] Your IT request has been logged`,
          content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
        }),
      });
      if (!sgRes.ok) console.error('create-ticket notify failed:', (await sgRes.text()).slice(0, 300));
      else notified = true;
    } catch (err) {
      console.error('create-ticket notify error:', (err as Error).message);
    }
  }

  return NextResponse.json({ ok: true, ticketId, notified }, { status: 201 });
}

function esc(s: string) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

type CreatedTicket = { id: string; subject: string; requester_name: string };

function buildCreatedHtml({ ticket, link }: { ticket: CreatedTicket; link: string }) {
  const first = esc((ticket.requester_name || '').split(' ')[0] || 'there');
  const summaryRow = ticket.subject ? `<div style="margin-top:4px;"><strong>Summary:</strong> ${esc(ticket.subject)}</div>` : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(ticket.id)}</title>${EMAIL_HEAD_STYLE}</head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#0F1C2E;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <tr><td align="left" style="padding:20px 28px;background:#fff;border-bottom:1px solid #E2E8EF;">
        ${emailLogoImgs(30)}
      </td></tr>
      <tr><td style="padding:24px 28px 16px;">
        <div style="font-size:12px;color:#6B7280;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">HDS IT Helpdesk · Ticket ${esc(ticket.id)}</div>
        <div style="font-size:18px;font-weight:600;color:#0F1C2E;margin-top:4px;">${esc(ticket.subject)}</div>
      </td></tr>
      <tr><td style="padding:24px 28px;font-size:14px;line-height:1.6;color:#0F1C2E;">
        <div style="margin-bottom:16px;">Hi ${first},</div>
        <div style="margin-bottom:16px;">We've logged your request with the HDS IT Helpdesk so we can track it properly and keep everything in one place.</div>
        <div style="margin:0 0 20px;padding:12px 14px;background:#F8F9FA;border:1px solid #E2E8EF;border-radius:8px;font-size:13px;">
          <div><strong>Ticket:</strong> ${esc(ticket.id)}</div>
          ${summaryRow}
        </div>
        <div style="margin-bottom:20px;">You can view it and reply directly in the portal, no need to go back and forth over email. Replying there keeps the whole conversation together and helps us get to you faster.</div>
        <div style="margin:24px 0;">
          <a href="${link}" style="display:inline-block;background:#1C64F2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">View &amp; reply in portal</a>
        </div>
        <div style="margin-bottom:0;">If something looks wrong or you weren't expecting this, just reply in the portal and let us know.</div>
        <div style="margin-top:24px;color:#6B7280;font-size:13px;">HDS IT Helpdesk</div>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#F8F9FA;border-top:1px solid #E2E8EF;font-size:12px;color:#6B7280;line-height:1.5;">
        Use the button above to view and reply. It signs you in automatically on any device.<br>
        Reference: <strong>${esc(ticket.id)}</strong>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function buildCreatedText({ ticket, link }: { ticket: CreatedTicket; link: string }) {
  const first = (ticket.requester_name || '').split(' ')[0] || 'there';
  const lines = [
    `Hi ${first},`, '',
    `We've logged your request with the HDS IT Helpdesk so we can track it properly and keep everything in one place.`, '',
    `  Ticket: ${ticket.id}`,
  ];
  if (ticket.subject) lines.push(`  Summary: ${ticket.subject}`);
  lines.push('',
    `You can view it and reply directly in the portal, no need to go back and forth over email. Replying there keeps the whole conversation together and helps us get to you faster.`, '',
    `View & reply in portal (signs you in automatically): ${link}`, '',
    `If something looks wrong or you weren't expecting this, just reply in the portal and let us know.`, '',
    `HDS IT Helpdesk`, '', '___________', `Reference: ${ticket.id}`);
  return lines.join('\n');
}

async function getOrCreateToken(admin: SupabaseClient, email: string) {
  const e = (email || '').toLowerCase().trim();
  const { data: existing } = await admin.from('user_access_tokens').select('token').eq('user_email', e).is('revoked_at', null).maybeSingle();
  if (existing && existing.token) return existing.token;
  const token = crypto.randomBytes(18).toString('base64url');
  const { error } = await admin.from('user_access_tokens').upsert({ user_email: e, token }, { onConflict: 'user_email' });
  if (error) throw error;
  return token;
}
