/* ═══════════════════════════════════════════════════════════════
   HDS IT HELPDESK — create-ticket function

   Lets IT staff raise a ticket on behalf of a requester from the admin
   dashboard (requests that arrived by email / Teams / in person). The
   submitter is NOT the requester — the form captures who it's for.

   Auth: Authorization: Bearer <jwt>. Caller must be admin or manager
   (verified server-side via user_roles), same as send-message.

   On submit:
     1. next_ticket_id() → HDS-NNNN
     2. Insert the ticket (service role) with requester_* fields,
        classification, chosen status + assignee (resolved_at if resolved).
     3. If notify is ON (default), email the requester a portal link with a
        NEW "request logged" template. Notify failure is non-fatal.

   The requester email is gated to HDS domains (internal staff only), same as
   the portal submit path.
   ═══════════════════════════════════════════════════════════════ */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SENDGRID_API_KEY          = process.env.SENDGRID_API_KEY;
const EMAIL_FROM                = process.env.EMAIL_FROM;
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

const VALID_STATUSES   = ['open', 'in-progress', 'waiting-on-admin', 'waiting-on-requester', 'on-hold', 'resolved', 'closed'];
const VALID_CATEGORIES = ['access', 'hardware', 'account', 'support'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const ALLOWED_DOMAINS  = ['homedelivery.com.au', 'hdsau.com'];   // internal HDS staff only

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
  if (userErr || !userData?.user) return res(401, { error: 'Invalid or expired session' });
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

  // ── 3. Parse + validate ────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return res(400, { error: 'Invalid JSON' }); }

  const {
    requesterName, requesterEmail, department, location, affectedUser,
    subject, category, subType, priority, description, status, assignedTo, notify,
  } = body;

  if (!subject || !String(subject).trim())             return res(400, { error: 'Subject is required' });
  if (!requesterName || !String(requesterName).trim()) return res(400, { error: 'Requester name is required' });
  const emailNorm = String(requesterEmail || '').toLowerCase().trim();
  if (!emailNorm || !emailNorm.includes('@'))          return res(400, { error: 'A valid requester email is required' });
  if (!ALLOWED_DOMAINS.includes(emailNorm.split('@')[1]))
    return res(400, { error: 'Requester email must be an HDS address (@homedelivery.com.au or @hdsau.com)' });
  if (!VALID_CATEGORIES.includes(category))            return res(400, { error: 'A valid category is required' });
  if (priority && !VALID_PRIORITIES.includes(priority)) return res(400, { error: 'Invalid priority' });

  const finalStatus = status || 'in-progress';
  if (!VALID_STATUSES.includes(finalStatus))           return res(400, { error: 'Invalid status' });

  // ── 4. Generate the ref ────────────────────────────────────
  const { data: ticketId, error: idErr } = await admin.rpc('next_ticket_id');
  if (idErr || !ticketId) {
    console.error('next_ticket_id failed:', idErr);
    return res(500, { error: 'Failed to generate ticket ID' });
  }

  // ── 5. Insert (service role; sub_type/description/department are NOT NULL) ─
  const now = new Date().toISOString();
  const row = {
    id:              ticketId,
    category,
    sub_type:        String(subType || '').trim(),
    priority:        priority || 'medium',
    subject:         String(subject).trim(),
    description:     String(description || '').trim(),
    requester_name:  String(requesterName).trim(),
    requester_email: emailNorm,
    department:      String(department || '').trim(),
    location:        location || null,
    affected_user:   affectedUser || null,
    status:          finalStatus,
    assigned_to:     assignedTo || null,
  };
  if (finalStatus === 'resolved' || finalStatus === 'closed') row.resolved_at = now;

  const { error: insErr } = await admin.from('tickets').insert([row]);
  if (insErr) {
    console.error('Ticket insert failed:', insErr);
    return res(500, { error: 'Failed to create ticket: ' + insErr.message });
  }

  // ── 6. Notify the requester (toggle ON by default; non-fatal) ─
  let notified = false;
  if (notify !== false) {
    try {
      const token = await getOrCreateToken(admin, emailNorm);
      const link  = token ? `${SITE_URL}/p/${token}/t/${ticketId}` : `${SITE_URL}/t/${ticketId}`;
      const ticket = { id: ticketId, subject: row.subject, requester_name: row.requester_name };
      const html = buildCreatedHtml({ ticket, link });
      const text = buildCreatedText({ ticket, link });

      const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: row.requester_email, name: row.requester_name }] }],
          from:     { email: EMAIL_FROM, name: 'HDS IT Helpdesk' },
          reply_to: { email: EMAIL_FROM, name: 'HDS IT Helpdesk' },
          subject:  `[${ticketId}] Your IT request has been logged`,
          content: [
            { type: 'text/plain', value: text },
            { type: 'text/html',  value: html },
          ],
        }),
      });
      if (!sgRes.ok) {
        const t = await sgRes.text();
        console.error('create-ticket notify failed:', t.slice(0, 300));
      } else {
        notified = true;
      }
    } catch (err) {
      console.error('create-ticket notify error:', err.message);
    }
  }

  return res(201, { ok: true, ticketId, notified });
};

// ─────────────────────────────────────────────────────────────
// EMAIL — admin-created ticket notification (same visual family as
// the requester reply email; only the copy differs).
// ─────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function buildCreatedHtml({ ticket, link }) {
  const first = esc((ticket.requester_name || '').split(' ')[0] || 'there');
  const summaryRow = ticket.subject
    ? `<div style="margin-top:4px;"><strong>Summary:</strong> ${esc(ticket.subject)}</div>`
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(ticket.id)}</title></head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#0F1C2E;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <tr><td align="left" style="padding:20px 28px;background:#fff;border-bottom:1px solid #E2E8EF;">
        <img src="https://cdn.prod.website-files.com/69d48f8f8f01871806e7f641/69e03c21c28ca297a9031891_Teritary-positive.png" alt="HDS" height="32" style="height:32px;width:auto;display:block;border:0;" />
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
        <div style="margin-bottom:20px;">You can view it and reply directly in the portal — no need to go back and forth over email. Replying there keeps the whole conversation together and helps us get to you faster.</div>
        <div style="margin:24px 0;">
          <a href="${link}" style="display:inline-block;background:#1C64F2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">View &amp; reply in portal</a>
        </div>
        <div style="margin-bottom:0;">If something looks wrong or you weren't expecting this, just reply in the portal and let us know.</div>
        <div style="margin-top:24px;color:#6B7280;font-size:13px;">— HDS IT Helpdesk</div>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#F8F9FA;border-top:1px solid #E2E8EF;font-size:12px;color:#6B7280;line-height:1.5;">
        Use the button above to view and reply — it signs you in automatically on any device.<br>
        Reference: <strong>${esc(ticket.id)}</strong>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function buildCreatedText({ ticket, link }) {
  const first = (ticket.requester_name || '').split(' ')[0] || 'there';
  const lines = [
    `Hi ${first},`,
    '',
    `We've logged your request with the HDS IT Helpdesk so we can track it properly and keep everything in one place.`,
    '',
    `  Ticket: ${ticket.id}`,
  ];
  if (ticket.subject) lines.push(`  Summary: ${ticket.subject}`);
  lines.push(
    '',
    `You can view it and reply directly in the portal — no need to go back and forth over email. Replying there keeps the whole conversation together and helps us get to you faster.`,
    '',
    `View & reply in portal (signs you in automatically): ${link}`,
    '',
    `If something looks wrong or you weren't expecting this, just reply in the portal and let us know.`,
    '',
    `— HDS IT Helpdesk`,
    '',
    '———',
    `Reference: ${ticket.id}`,
  );
  return lines.join('\n');
}

// Reuse the requester's portable token so the link signs them in (same as send-message).
async function getOrCreateToken(admin, email) {
  const e = (email || '').toLowerCase().trim();
  const { data: existing } = await admin
    .from('user_access_tokens')
    .select('token')
    .eq('user_email', e)
    .is('revoked_at', null)
    .maybeSingle();
  if (existing && existing.token) return existing.token;
  const token = crypto.randomBytes(18).toString('base64url');
  const { error } = await admin
    .from('user_access_tokens')
    .upsert({ user_email: e, token }, { onConflict: 'user_email' });
  if (error) throw error;
  return token;
}
