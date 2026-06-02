/* ═══════════════════════════════════════════════════════════════
   HDS IT HELPDESK — send-message function

   Two modes (controlled by `direction` in the body):
     • 'outbound' → IT replies to the requester
         - Sends an email via SendGrid (subject: Re: [HDS-NNNN] …)
         - Logs the message as a note with note_type='outbound'
         - Optionally updates the ticket status
     • 'inbound'  → IT logs a reply that came back via email
         - NO email sent
         - Logs the pasted reply as a note with note_type='inbound'
         - Optionally updates the ticket status

   Auth: the caller MUST supply a valid Supabase access token
   (Authorization: Bearer <jwt>). The function validates it server-
   side and checks the user has admin OR manager role; managers may
   only act on tickets in their department.
   ═══════════════════════════════════════════════════════════════ */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SENDGRID_API_KEY          = process.env.SENDGRID_API_KEY;
const EMAIL_FROM                = process.env.EMAIL_FROM;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function res(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return res(405, { error: 'Method not allowed' });

  // ── 1. Auth: validate the bearer token ─────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res(401, { error: 'Missing or malformed Authorization header' });
  }
  const accessToken = authHeader.slice(7);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) {
    return res(401, { error: 'Invalid or expired session' });
  }
  const callerUser = userData.user;

  // ── 2. Authorize: must be admin or manager ─────────────────
  const { data: roleRow, error: roleErr } = await admin
    .from('user_roles')
    .select('role, department, full_name')
    .eq('user_id', callerUser.id)
    .maybeSingle();

  if (roleErr) return res(500, { error: 'Role lookup failed: ' + roleErr.message });
  if (!roleRow || !['admin', 'manager'].includes(roleRow.role)) {
    return res(403, { error: 'Account does not have IT staff access' });
  }

  // ── 3. Parse and validate payload ──────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return res(400, { error: 'Invalid JSON' }); }

  const { ticketId, message, direction, newStatus } = body;

  if (!ticketId || typeof ticketId !== 'string')
    return res(400, { error: 'ticketId is required' });
  if (!message || typeof message !== 'string' || !message.trim())
    return res(400, { error: 'message is required' });
  if (!['outbound', 'inbound'].includes(direction))
    return res(400, { error: "direction must be 'outbound' or 'inbound'" });
  if (message.length > 10000)
    return res(400, { error: 'Message too long (max 10,000 chars)' });

  const VALID_STATUSES = ['open', 'in-progress', 'waiting-on-requester', 'on-hold', 'resolved', 'closed'];
  if (newStatus && !VALID_STATUSES.includes(newStatus))
    return res(400, { error: 'Invalid newStatus' });

  // ── 4. Fetch the ticket ────────────────────────────────────
  const { data: ticket, error: ticketErr } = await admin
    .from('tickets')
    .select('id, subject, requester_name, requester_email, department, status')
    .eq('id', ticketId)
    .maybeSingle();

  if (ticketErr) return res(500, { error: 'Ticket lookup failed: ' + ticketErr.message });
  if (!ticket)   return res(404, { error: 'Ticket not found' });

  // Managers may only act on tickets in their department.
  if (roleRow.role === 'manager' && ticket.department !== roleRow.department) {
    return res(403, { error: 'Manager scope does not include this ticket' });
  }

  const addedBy = roleRow.full_name || callerUser.email || 'IT Staff';

  // ── 5. Send the email (outbound only) ──────────────────────
  if (direction === 'outbound') {
    const subject = `Re: [${ticket.id}] ${ticket.subject}`;
    const html = buildReplyHtml({ ticket, message, addedBy });
    const text = buildReplyText({ ticket, message, addedBy });

    try {
      const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SENDGRID_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          personalizations: [{
            to: [{ email: ticket.requester_email, name: ticket.requester_name }],
          }],
          from: { email: EMAIL_FROM, name: 'HDS IT Helpdesk' },
          reply_to: { email: EMAIL_FROM, name: 'HDS IT Helpdesk' },
          subject,
          content: [
            { type: 'text/plain', value: text },
            { type: 'text/html',  value: html },
          ],
        }),
      });

      if (!sgRes.ok) {
        const errText = await sgRes.text();
        return res(502, { error: 'Email send failed: ' + errText.slice(0, 300) });
      }
    } catch (err) {
      return res(502, { error: 'Email send failed: ' + err.message });
    }
  }

  // ── 6. Log the note ────────────────────────────────────────
  const { error: noteErr } = await admin
    .from('ticket_notes')
    .insert({
      ticket_id: ticket.id,
      added_by:  addedBy,
      note_text: message.trim(),
      note_type: direction,
    });

  if (noteErr) return res(500, { error: 'Failed to log note: ' + noteErr.message });

  // ── 7. Update ticket status (optional) ─────────────────────
  if (newStatus && newStatus !== ticket.status) {
    const update = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === 'resolved' || newStatus === 'closed') {
      update.resolved_at = new Date().toISOString();
    }
    const { error: updErr } = await admin
      .from('tickets')
      .update(update)
      .eq('id', ticket.id);
    if (updErr) return res(500, { error: 'Status update failed: ' + updErr.message });
  }

  return res(200, { ok: true, direction, ticketId: ticket.id });
};

// ─────────────────────────────────────────────────────────────
// EMAIL TEMPLATES
// ─────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function buildReplyHtml({ ticket, message, addedBy }) {
  const bodyHtml = esc(message).replace(/\n/g, '<br>');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(ticket.id)}</title></head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#0F1C2E;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <tr><td style="padding:24px 28px 16px;border-bottom:1px solid #E2E8EF;">
        <div style="font-size:12px;color:#6B7280;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">HDS IT Helpdesk · Ticket ${esc(ticket.id)}</div>
        <div style="font-size:18px;font-weight:600;color:#0F1C2E;margin-top:4px;">${esc(ticket.subject)}</div>
      </td></tr>
      <tr><td style="padding:24px 28px;font-size:14px;line-height:1.6;color:#0F1C2E;">
        <div style="margin-bottom:16px;">Hi ${esc(ticket.requester_name.split(' ')[0])},</div>
        <div style="margin-bottom:20px;">${bodyHtml}</div>
        <div style="margin-top:24px;color:#6B7280;font-size:13px;">— ${esc(addedBy)}<br>HDS IT Helpdesk</div>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#F8F9FA;border-top:1px solid #E2E8EF;font-size:12px;color:#6B7280;line-height:1.5;">
        Reply to this email to respond — your reply will reach the IT team.<br>
        Reference: <strong>${esc(ticket.id)}</strong>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function buildReplyText({ ticket, message, addedBy }) {
  return [
    `Hi ${ticket.requester_name.split(' ')[0]},`,
    '',
    message.trim(),
    '',
    `— ${addedBy}`,
    `HDS IT Helpdesk`,
    '',
    '———',
    `Reply to this email to respond. Reference: ${ticket.id}`,
  ].join('\n');
}
