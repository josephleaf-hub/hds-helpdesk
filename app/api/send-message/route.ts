/* Port of netlify/functions/send-message.js — IT replies to a requester
   ('outbound', sends email) or logs an emailed reply ('inbound', no email).
   Auth: Bearer JWT, admin or manager (managers scoped to their dept). */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { siteUrl } from '@/lib/site';
import { emailLogoImgs, EMAIL_HEAD_STYLE } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUSES = ['new', 'in-progress', 'waiting-on-admin', 'waiting-on-requester', 'on-hold', 'resolved', 'closed'];

export async function POST(req: NextRequest) {
  const SITE_URL = siteUrl(req);
  const EMAIL_FROM = process.env.EMAIL_FROM!;

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return NextResponse.json({ error: 'Missing or malformed Authorization header' }, { status: 401 });
  const accessToken = authHeader.slice(7);

  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  const callerUser = userData.user;

  const { data: roleRow, error: roleErr } = await admin.from('user_roles').select('role, department, full_name').eq('user_id', callerUser.id).maybeSingle();
  if (roleErr) return NextResponse.json({ error: 'Role lookup failed: ' + roleErr.message }, { status: 500 });
  if (!roleRow || !['admin', 'manager'].includes(roleRow.role)) return NextResponse.json({ error: 'Account does not have IT staff access' }, { status: 403 });

  let body: { ticketId?: string; message?: string; direction?: string; newStatus?: string; attachmentIds?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { ticketId, message, direction, newStatus } = body;
  const atts = Array.isArray(body.attachmentIds) ? body.attachmentIds.filter((x): x is string => typeof x === 'string') : [];
  const hasMsg = typeof message === 'string' && message.trim().length > 0;

  if (!ticketId || typeof ticketId !== 'string') return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
  if (!hasMsg && !atts.length) return NextResponse.json({ error: 'A message or an attachment is required' }, { status: 400 });
  if (!['outbound', 'inbound'].includes(direction || '')) return NextResponse.json({ error: "direction must be 'outbound' or 'inbound'" }, { status: 400 });
  if (hasMsg && message!.length > 10000) return NextResponse.json({ error: 'Message too long (max 10,000 chars)' }, { status: 400 });
  if (newStatus && !VALID_STATUSES.includes(newStatus)) return NextResponse.json({ error: 'Invalid newStatus' }, { status: 400 });

  const { data: ticket, error: ticketErr } = await admin
    .from('tickets').select('id, subject, requester_name, requester_email, department, status').eq('id', ticketId).maybeSingle();
  if (ticketErr) return NextResponse.json({ error: 'Ticket lookup failed: ' + ticketErr.message }, { status: 500 });
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  if (roleRow.role === 'manager' && ticket.department !== roleRow.department) return NextResponse.json({ error: 'Manager scope does not include this ticket' }, { status: 403 });

  const addedBy = roleRow.full_name || callerUser.email || 'IT Staff';

  if (direction === 'outbound') {
    const subject = `Re: [${ticket.id}] ${ticket.subject}`;
    const token = await resolveToken(admin, ticket);
    const link = token ? `${SITE_URL}/p/${token}/t/${ticket.id}` : `${SITE_URL}/t/${ticket.id}`;
    const allLink = token ? `${SITE_URL}/p/${token}` : SITE_URL;
    const html = buildReplyHtml({ ticket, message: message || '', attachCount: atts.length, link, allLink });
    const text = buildReplyText({ ticket, message: message || '', attachCount: atts.length, link, allLink });
    try {
      const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: ticket.requester_email, name: ticket.requester_name }] }],
          from: { email: EMAIL_FROM, name: 'HDS IT Helpdesk' },
          reply_to: { email: EMAIL_FROM, name: 'HDS IT Helpdesk' },
          subject,
          content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
        }),
      });
      if (!sgRes.ok) return NextResponse.json({ error: 'Email send failed: ' + (await sgRes.text()).slice(0, 300) }, { status: 502 });
    } catch (err) {
      return NextResponse.json({ error: 'Email send failed: ' + (err as Error).message }, { status: 502 });
    }
  }

  const { data: noteRow, error: noteErr } = await admin
    .from('ticket_notes').insert({ ticket_id: ticket.id, added_by: addedBy, note_text: hasMsg ? message!.trim() : '', note_type: direction }).select('id').single();
  if (noteErr) return NextResponse.json({ error: 'Failed to log note: ' + noteErr.message }, { status: 500 });

  if (atts.length) {
    await admin.from('ticket_attachments').update({ note_id: noteRow.id }).eq('ticket_id', ticket.id).is('note_id', null).in('id', atts);
  }

  const finalStatus = newStatus || (direction === 'outbound' ? 'waiting-on-requester' : 'waiting-on-admin');
  if (finalStatus && finalStatus !== ticket.status) {
    const now = new Date().toISOString();
    const update: Record<string, unknown> = { status: finalStatus, updated_at: now };
    if (finalStatus === 'resolved' || finalStatus === 'closed') update.resolved_at = now;
    else if (['resolved', 'closed'].includes(ticket.status)) update.resolved_at = null;
    const { error: updErr } = await admin.from('tickets').update(update).eq('id', ticket.id);
    if (updErr) return NextResponse.json({ error: 'Status update failed: ' + updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, direction, ticketId: ticket.id });
}

function esc(s: string) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

type ReplyTicket = { id: string; subject: string; requester_name: string; requester_email: string };

function buildReplyHtml({ ticket, message, attachCount, link, allLink }: { ticket: ReplyTicket; message: string; attachCount: number; link: string; allLink: string }) {
  const bodyHtml = (message && message.trim()) ? esc(message).replace(/\n/g, '<br>') : '<em style="color:#6B7280;">A screenshot was attached. Open the portal to view it.</em>';
  const attachBadge = attachCount > 0
    ? `<div style="margin:0 0 18px;"><span style="display:inline-flex;align-items:center;gap:6px;background:#EBF2FF;color:#1C64F2;font-size:12px;font-weight:600;padding:5px 11px;border-radius:14px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> ${attachCount} image${attachCount > 1 ? 's' : ''} attached, view in the portal</span></div>`
    : '';
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
        <div style="margin-bottom:16px;">Hi ${esc(ticket.requester_name.split(' ')[0])},</div>
        <div style="margin-bottom:20px;">${bodyHtml}</div>
        ${attachBadge}
        <div style="margin:24px 0;">
          <a href="${link}" style="display:inline-block;background:#1C64F2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">View &amp; reply in portal</a>
          <a href="${allLink}" style="display:inline-block;margin-left:8px;background:#fff;color:#1C64F2;border:1px solid #C8D4DF;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:8px;">All my tickets</a>
        </div>
        <div style="margin-top:24px;color:#6B7280;font-size:13px;">The HDS IT Helpdesk team</div>
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

function buildReplyText({ ticket, message, attachCount, link, allLink }: { ticket: ReplyTicket; message: string; attachCount: number; link: string; allLink: string }) {
  const lines = [
    `Hi ${ticket.requester_name.split(' ')[0]},`, '',
    (message && message.trim()) ? message.trim() : 'A screenshot was attached. Open the portal to view it.',
  ];
  if (attachCount > 0 && message && message.trim()) lines.push('', `(${attachCount} image${attachCount > 1 ? 's' : ''} attached, view in the portal)`);
  lines.push('', `The HDS IT Helpdesk team`, '', '___________',
    `Reply to this conversation (signs you in automatically): ${link}`, `All your tickets: ${allLink}`, `Reference: ${ticket.id}`);
  return lines.join('\n');
}

async function resolveToken(admin: SupabaseClient, ticket: { requester_email: string }) {
  try { return await getOrCreateToken(admin, ticket.requester_email); }
  catch (e) { console.error('Token lookup failed, using plain link:', (e as Error).message); return null; }
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
