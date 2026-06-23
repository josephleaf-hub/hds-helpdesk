/* Assign a ticket to an IT staff member, record a handover note, and email the
   new assignee. Admin/manager only (Bearer JWT + user_roles; managers scoped to
   their department). The handover note is written as an internal note so the
   context lives on the ticket (the in-app record); the email is the proactive
   notify. Sets assigned_to = the assignee's user_id. */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { siteUrl } from '@/lib/site';
import { emailLogoRow, EMAIL_HEAD_STYLE } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function esc(s: string) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export async function POST(req: NextRequest) {
  const SITE_URL = siteUrl(req);
  const EMAIL_FROM = process.env.EMAIL_FROM!;

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return NextResponse.json({ error: 'Missing or malformed Authorization header' }, { status: 401 });
  const accessToken = authHeader.slice(7);

  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  const callerId = userData.user.id;

  const { data: caller, error: roleErr } = await admin.from('user_roles').select('role, department, full_name').eq('user_id', callerId).maybeSingle();
  if (roleErr) return NextResponse.json({ error: 'Role lookup failed: ' + roleErr.message }, { status: 500 });
  if (!caller || !['admin', 'manager'].includes(caller.role)) return NextResponse.json({ error: 'Account does not have IT staff access' }, { status: 403 });

  let body: { ticketId?: string; assigneeId?: string; handover?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const ticketId = String(body.ticketId || '').trim();
  const assigneeId = String(body.assigneeId || '').trim();
  const handover = (typeof body.handover === 'string' ? body.handover : '').trim();
  if (!ticketId || !assigneeId) return NextResponse.json({ error: 'ticketId and assigneeId are required' }, { status: 400 });
  if (handover.length > 4000) return NextResponse.json({ error: 'Handover note too long (max 4,000 chars)' }, { status: 400 });

  const { data: ticket, error: tErr } = await admin.from('tickets').select('id, subject, department, status').eq('id', ticketId).maybeSingle();
  if (tErr) return NextResponse.json({ error: 'Ticket lookup failed: ' + tErr.message }, { status: 500 });
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  if (caller.role === 'manager' && ticket.department !== caller.department) return NextResponse.json({ error: 'Manager scope does not include this ticket' }, { status: 403 });

  // Assignee must be a real admin/manager.
  const { data: assignee, error: aErr } = await admin.from('user_roles').select('full_name, role').eq('user_id', assigneeId).maybeSingle();
  if (aErr) return NextResponse.json({ error: 'Assignee lookup failed: ' + aErr.message }, { status: 500 });
  if (!assignee || !['admin', 'manager'].includes(assignee.role)) return NextResponse.json({ error: 'That person is not an assignable IT staff member' }, { status: 400 });

  const assignerName = caller.full_name || userData.user.email || 'IT Staff';
  const assigneeName = assignee.full_name || 'IT staff';

  // 1. Set the assignee.
  const { error: updErr } = await admin.from('tickets').update({ assigned_to: assigneeId }).eq('id', ticketId);
  if (updErr) return NextResponse.json({ error: 'Assignment failed: ' + updErr.message }, { status: 500 });

  // 2. Record a handover note (internal — IT-only, lives on the ticket).
  const noteText = `Assigned to ${assigneeName} by ${assignerName}.${handover ? `\n\nHandover note:\n${handover}` : ''}`;
  const { error: noteErr } = await admin.from('ticket_notes').insert({ ticket_id: ticketId, added_by: assignerName, note_text: noteText, note_type: 'internal' });
  if (noteErr) console.error('assign-ticket: failed to write handover note', noteErr.message);

  // 3. Email the new assignee (skip if assigning to yourself; non-fatal).
  let emailed = false;
  if (assigneeId !== callerId) {
    try {
      const { data: au } = await admin.auth.admin.getUserById(assigneeId);
      const toEmail = au?.user?.email;
      if (toEmail && process.env.SENDGRID_API_KEY) {
        const link = `${SITE_URL}/admin?ticket=${ticket.id}`;
        const html = buildAssignHtml({ ticketId: ticket.id, subject: ticket.subject, assigneeFirst: assigneeName.split(' ')[0] || assigneeName, assignerName, handover, link });
        const text = buildAssignText({ ticketId: ticket.id, subject: ticket.subject, assignerName, handover, link });
        const sg = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: toEmail, name: assigneeName }] }],
            from: { email: EMAIL_FROM, name: 'HDS IT Helpdesk' },
            subject: `Ticket assigned to you: [${ticket.id}] ${ticket.subject}`,
            content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
          }),
        });
        emailed = sg.ok;
        if (!sg.ok) console.error('assign-ticket: SendGrid error', sg.status, (await sg.text().catch(() => '')).slice(0, 200));
      }
    } catch (err) {
      console.error('assign-ticket: email failed', (err as Error).message);
    }
  }

  return NextResponse.json({ ok: true, assigneeId, assigneeName, emailed });
}

function buildAssignText({ ticketId, subject, assignerName, handover, link }: { ticketId: string; subject: string; assignerName: string; handover: string; link: string }) {
  const lines = [
    `${assignerName} has assigned a ticket to you.`, '',
    `Ticket: ${ticketId}`, `Subject: ${subject}`,
  ];
  if (handover) lines.push('', 'Handover note:', handover);
  lines.push('', `Open it: ${link}`);
  return lines.join('\n');
}

function buildAssignHtml({ ticketId, subject, assigneeFirst, assignerName, handover, link }: { ticketId: string; subject: string; assigneeFirst: string; assignerName: string; handover: string; link: string }) {
  const handoverBlock = handover
    ? `<div style="margin:16px 0;padding:12px 14px;background:#F8F9FB;border:1px solid #E2E8EF;border-radius:8px;font-size:14px;line-height:1.6;color:#0F1C2E;white-space:pre-wrap;"><div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#6B7280;margin-bottom:6px;">Handover note</div>${esc(handover)}</div>`
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(ticketId)}</title>${EMAIL_HEAD_STYLE}</head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#0F1C2E;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      ${emailLogoRow()}
      <tr><td style="padding:24px 28px 16px;border-bottom:1px solid #E2E8EF;">
        <div style="font-size:12px;color:#6B7280;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Ticket assigned · ${esc(ticketId)}</div>
        <div style="font-size:18px;font-weight:600;color:#0F1C2E;margin-top:4px;">${esc(subject)}</div>
      </td></tr>
      <tr><td style="padding:22px 28px;font-size:14px;line-height:1.6;color:#0F1C2E;">
        <div style="margin-bottom:8px;">Hi ${esc(assigneeFirst)},</div>
        <div style="margin-bottom:8px;"><strong>${esc(assignerName)}</strong> has assigned this ticket to you.</div>
        ${handoverBlock}
        <div style="margin:22px 0 4px;">
          <a href="${link}" style="display:inline-block;background:#1C64F2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">Open the ticket</a>
        </div>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#F8F9FA;border-top:1px solid #E2E8EF;font-size:12px;color:#6B7280;line-height:1.5;">
        Reference: <strong>${esc(ticketId)}</strong>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
