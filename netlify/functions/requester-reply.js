/* ═══════════════════════════════════════════════════════════════
   HDS IT HELPDESK — requester-reply function

   The requester (staff member) replies to their own ticket from the
   portal. This runs on the service role so it can ALSO notify IT and
   (optionally) resolve the ticket — which is why requesters have no
   direct INSERT/UPDATE RLS on tickets/notes.

   Does:
     • Validates the caller's Supabase JWT and that the caller's email
       matches the ticket's requester_email (case-insensitive).
     • Logs the reply as a note with note_type='inbound'.
     • If body.resolve === true AND the ticket is 'waiting-on-requester',
       flips status → 'resolved'.
     • Emails IT_SUPPORT_EMAIL a short "{requester} replied" notification
       with a link into the admin dashboard.

   Auth: Authorization: Bearer <requester JWT>.
   ═══════════════════════════════════════════════════════════════ */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SENDGRID_API_KEY          = process.env.SENDGRID_API_KEY;
const EMAIL_FROM                = process.env.EMAIL_FROM;
const IT_SUPPORT_EMAIL          = process.env.IT_SUPPORT_EMAIL || EMAIL_FROM;
const SITE_URL                  = 'https://it-helpdesk.hdsaus.com.au';

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
  const callerEmail = (userData.user.email || '').toLowerCase();
  if (!callerEmail) return res(401, { error: 'Session has no email' });

  // ── 2. Parse and validate payload ──────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return res(400, { error: 'Invalid JSON' }); }

  const { ticketId, message, resolve } = body;

  if (!ticketId || typeof ticketId !== 'string')
    return res(400, { error: 'ticketId is required' });

  const hasMessage = typeof message === 'string' && message.trim().length > 0;
  if (!hasMessage && resolve !== true)
    return res(400, { error: 'Provide a message or set resolve' });
  if (hasMessage && message.length > 10000)
    return res(400, { error: 'Message too long (max 10,000 chars)' });

  // ── 3. Fetch the ticket and authorize by email ─────────────
  const { data: ticket, error: ticketErr } = await admin
    .from('tickets')
    .select('id, subject, requester_name, requester_email, status')
    .eq('id', ticketId)
    .maybeSingle();

  if (ticketErr) return res(500, { error: 'Ticket lookup failed: ' + ticketErr.message });
  if (!ticket)   return res(404, { error: 'Ticket not found' });

  if ((ticket.requester_email || '').toLowerCase() !== callerEmail) {
    return res(403, { error: 'This ticket does not belong to you' });
  }

  // ── 4. Log the inbound note (only if a message was sent) ───
  if (hasMessage) {
    const { error: noteErr } = await admin
      .from('ticket_notes')
      .insert({
        ticket_id: ticket.id,
        added_by:  ticket.requester_name || callerEmail,
        note_text: message.trim(),
        note_type: 'inbound',
      });
    if (noteErr) return res(500, { error: 'Failed to log reply: ' + noteErr.message });
  }

  // ── 5. Optional resolve (only from waiting-on-requester) ───
  let resolved = false;
  if (resolve === true && ticket.status === 'waiting-on-requester') {
    const now = new Date().toISOString();
    const { error: updErr } = await admin
      .from('tickets')
      .update({ status: 'resolved', resolved_at: now, updated_at: now })
      .eq('id', ticket.id);
    if (updErr) return res(500, { error: 'Resolve failed: ' + updErr.message });
    resolved = true;
  }

  // ── 6. Notify IT (non-blocking: reply is already logged) ───
  try {
    await notifyIT({ ticket, message: hasMessage ? message.trim() : '', resolved });
  } catch (err) {
    console.error('IT notification failed:', err.message);
  }

  return res(200, { ok: true, ticketId: ticket.id, resolved });
};

// ─────────────────────────────────────────────────────────────
// EMAIL: notify IT that the requester replied
// ─────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

async function notifyIT({ ticket, message, resolved }) {
  const adminLink = `${SITE_URL}/admin#${ticket.id}`;
  const who = ticket.requester_name || ticket.requester_email;
  const subject = `Re: [${ticket.id}] ${ticket.subject}`;
  const bodyHtml = message
    ? esc(message).replace(/\n/g, '<br>')
    : '<em style="color:#6B7280;">(No message — ticket marked resolved.)</em>';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(ticket.id)}</title></head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#0F1C2E;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <tr><td style="padding:24px 28px 16px;border-bottom:1px solid #E2E8EF;">
        <div style="font-size:12px;color:#6B7280;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">HDS IT Helpdesk · Ticket ${esc(ticket.id)}</div>
        <div style="font-size:18px;font-weight:600;color:#0F1C2E;margin-top:4px;">${esc(who)} replied${resolved ? ' and marked this resolved' : ''}</div>
        <div style="font-size:13px;color:#6B7280;margin-top:2px;">${esc(ticket.subject)}</div>
      </td></tr>
      <tr><td style="padding:24px 28px;font-size:14px;line-height:1.6;color:#0F1C2E;">
        <div style="margin-bottom:20px;">${bodyHtml}</div>
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
    `${who} replied on ticket ${ticket.id}${resolved ? ' and marked it resolved' : ''}.`,
    '',
    message,
    '',
    '———',
    `View in dashboard: ${adminLink}`,
  ].join('\n');

  const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: IT_SUPPORT_EMAIL }] }],
      from: { email: EMAIL_FROM, name: 'HDS IT Helpdesk' },
      reply_to: { email: ticket.requester_email, name: ticket.requester_name },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html',  value: html },
      ],
    }),
  });
  if (!sgRes.ok) {
    const t = await sgRes.text();
    throw new Error('SendGrid ' + sgRes.status + ': ' + t.slice(0, 200));
  }
}
