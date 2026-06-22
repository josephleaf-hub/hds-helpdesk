/* Port of netlify/functions/requester-reply.js — the requester replies to their
   own ticket from the portal (service role: logs inbound note, optional resolve,
   notifies IT). Auth: Bearer <requester JWT>, email must match the ticket. */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { siteUrl } from '@/lib/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const SITE_URL = siteUrl(req);
  const EMAIL_FROM = process.env.EMAIL_FROM!;
  const IT_SUPPORT_EMAIL = process.env.IT_SUPPORT_EMAIL || EMAIL_FROM;

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return NextResponse.json({ error: 'Missing or malformed Authorization header' }, { status: 401 });
  const accessToken = authHeader.slice(7);

  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  const callerEmail = (userData.user.email || '').toLowerCase();
  if (!callerEmail) return NextResponse.json({ error: 'Session has no email' }, { status: 401 });

  let body: { ticketId?: string; message?: string; resolve?: boolean; attachmentIds?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { ticketId, message, resolve } = body;
  const atts = Array.isArray(body.attachmentIds) ? body.attachmentIds.filter((x): x is string => typeof x === 'string') : [];

  if (!ticketId || typeof ticketId !== 'string') return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
  const hasMessage = typeof message === 'string' && message.trim().length > 0;
  if (!hasMessage && !atts.length && resolve !== true) return NextResponse.json({ error: 'Provide a message, an image, or set resolve' }, { status: 400 });
  if (hasMessage && message!.length > 10000) return NextResponse.json({ error: 'Message too long (max 10,000 chars)' }, { status: 400 });

  const { data: ticket, error: ticketErr } = await admin
    .from('tickets').select('id, subject, requester_name, requester_email, status').eq('id', ticketId).maybeSingle();
  if (ticketErr) return NextResponse.json({ error: 'Ticket lookup failed: ' + ticketErr.message }, { status: 500 });
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  if ((ticket.requester_email || '').toLowerCase() !== callerEmail) return NextResponse.json({ error: 'This ticket does not belong to you' }, { status: 403 });

  if (hasMessage || atts.length) {
    const { data: noteRow, error: noteErr } = await admin
      .from('ticket_notes')
      .insert({ ticket_id: ticket.id, added_by: ticket.requester_name || callerEmail, note_text: hasMessage ? message!.trim() : '', note_type: 'inbound' })
      .select('id').single();
    if (noteErr) return NextResponse.json({ error: 'Failed to log reply: ' + noteErr.message }, { status: 500 });
    if (atts.length) {
      await admin.from('ticket_attachments').update({ note_id: noteRow.id }).eq('ticket_id', ticket.id).is('note_id', null).in('id', atts);
    }
  }

  const now = new Date().toISOString();
  let resolved = false;
  let reopened = false;
  if (resolve === true) {
    const { error: updErr } = await admin.from('tickets').update({ status: 'resolved', resolved_at: now, updated_at: now }).eq('id', ticket.id);
    if (updErr) return NextResponse.json({ error: 'Resolve failed: ' + updErr.message }, { status: 500 });
    resolved = true;
  } else {
    reopened = ['resolved', 'closed'].includes(ticket.status);
    if (ticket.status !== 'waiting-on-admin') {
      const update: Record<string, unknown> = { status: 'waiting-on-admin', updated_at: now };
      if (reopened) update.resolved_at = null;
      const { error: updErr } = await admin.from('tickets').update(update).eq('id', ticket.id);
      if (updErr) return NextResponse.json({ error: 'Status update failed: ' + updErr.message }, { status: 500 });
    }
    if (reopened) {
      await admin.from('ticket_notes').insert({ ticket_id: ticket.id, added_by: 'System', note_text: 'Ticket reopened by requester.', note_type: 'internal' });
    }
  }

  try {
    await notifyIT({ ticket, message: hasMessage ? message!.trim() : '', resolved, reopened, attachCount: atts.length, SITE_URL, EMAIL_FROM, IT_SUPPORT_EMAIL });
  } catch (err) {
    console.error('IT notification failed:', (err as Error).message);
  }

  return NextResponse.json({ ok: true, ticketId: ticket.id, resolved });
}

function esc(s: string) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

type ReplyTicket = { id: string; subject: string; requester_name: string; requester_email: string };

async function notifyIT(opts: { ticket: ReplyTicket; message: string; resolved: boolean; reopened: boolean; attachCount: number; SITE_URL: string; EMAIL_FROM: string; IT_SUPPORT_EMAIL: string }) {
  const { ticket, message, resolved, reopened, attachCount, SITE_URL, EMAIL_FROM, IT_SUPPORT_EMAIL } = opts;
  const adminLink = `${SITE_URL}/admin?ticket=${ticket.id}`;
  const who = ticket.requester_name || ticket.requester_email;
  const subject = `Re: [${ticket.id}] ${ticket.subject}`;
  const bodyHtml = message ? esc(message).replace(/\n/g, '<br>') : '<em style="color:#6B7280;">(No message — open the ticket in the dashboard.)</em>';
  const attachBadge = attachCount > 0
    ? `<div style="margin:0 0 18px;"><span style="display:inline-flex;align-items:center;gap:6px;background:#EBF2FF;color:#1C64F2;font-size:12px;font-weight:600;padding:5px 11px;border-radius:14px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> ${attachCount} image${attachCount > 1 ? 's' : ''} attached — view in the dashboard</span></div>`
    : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(ticket.id)}</title></head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#0F1C2E;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <tr><td style="padding:24px 28px 16px;border-bottom:1px solid #E2E8EF;">
        <div style="font-size:12px;color:#6B7280;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">HDS IT Helpdesk · Ticket ${esc(ticket.id)}</div>
        <div style="font-size:18px;font-weight:600;color:#0F1C2E;margin-top:4px;">${esc(who)} replied${resolved ? ' and marked this resolved' : (reopened ? ' (ticket reopened)' : '')}</div>
        <div style="font-size:13px;color:#6B7280;margin-top:2px;">${esc(ticket.subject)}</div>
      </td></tr>
      <tr><td style="padding:24px 28px;font-size:14px;line-height:1.6;color:#0F1C2E;">
        <div style="margin-bottom:20px;">${bodyHtml}</div>
        ${attachBadge}
        <a href="${adminLink}" style="display:inline-block;background:#1C64F2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:8px;">View ticket in dashboard</a>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#F8F9FA;border-top:1px solid #E2E8EF;font-size:12px;color:#6B7280;line-height:1.5;">
        Reference: <strong>${esc(ticket.id)}</strong>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text = [
    `${who} replied on ticket ${ticket.id}${resolved ? ' and marked it resolved' : ''}${attachCount > 0 ? ` (${attachCount} image${attachCount > 1 ? 's' : ''} attached)` : ''}.`,
    '', message, '', '———', `View in dashboard: ${adminLink}`,
  ].join('\n');

  const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: IT_SUPPORT_EMAIL }] }],
      from: { email: EMAIL_FROM, name: 'HDS IT Helpdesk' },
      reply_to: { email: ticket.requester_email, name: ticket.requester_name },
      subject,
      content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
    }),
  });
  if (!sgRes.ok) throw new Error('SendGrid ' + sgRes.status + ': ' + (await sgRes.text()).slice(0, 200));
}
