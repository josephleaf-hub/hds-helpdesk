/**
 * HDS IT Helpdesk — Submit Ticket Function
 * POST /api/submit-ticket
 *
 * Creates a ticket in Supabase and sends an email notification
 * via SendGrid to itsupporttickets@hdsau.com.au
 *
 * Required env vars (set in Netlify → Site Settings → Environment Variables):
 *   SUPABASE_URL              — e.g. https://xxxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — from Supabase → Settings → API (service_role key)
 *   SENDGRID_API_KEY          — from SendGrid → Settings → API Keys (Full Access or Mail Send)
 *   EMAIL_FROM                — e.g. helpdesk@homedelivery.com.au (must be a verified sender in SendGrid)
 *   IT_SUPPORT_EMAIL          — defaults to itsupporttickets@hdsau.com.au
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const SITE_URL = 'https://it-helpdesk.hdsaus.com.au';
// Keep in sync with ALLOWED_DOMAINS in index.html — the no-build setup can't
// share a constant between the browser file and this Lambda bundle.
const ALLOWED_DOMAINS = ['homedelivery.com.au', 'hdsau.com'];

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Parse body ──────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const {
    category, subType, priority, subject, description,
    requesterName, requesterEmail, department, location, affectedUser
  } = body;

  // ── Validate required fields ──────────────────
  if (!category || !subType || !priority || !subject || !description || !requesterName || !requesterEmail || !department) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
  }
  if (!requesterEmail.includes('@')) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email address' }) };
  }
  // Server-side domain allow-list (security boundary — client validates too).
  const emailNorm = requesterEmail.toLowerCase().trim();
  if (!ALLOWED_DOMAINS.includes(emailNorm.split('@')[1])) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please use your HDS work email' }) };
  }

  // ── Supabase client (service role — bypasses RLS) ──
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  // ── Generate sequential ticket ID ──────────────
  const { data: ticketId, error: idError } = await supabase.rpc('next_ticket_id');
  if (idError || !ticketId) {
    console.error('Ticket ID error:', idError);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to generate ticket ID' }) };
  }

  // ── Insert ticket ──────────────────────────────
  const { error: insertError } = await supabase.from('tickets').insert([{
    id:              ticketId,
    category,
    sub_type:        subType,
    priority,
    subject,
    description,
    requester_name:  requesterName,
    requester_email: emailNorm,
    department,
    location:        location   || null,
    affected_user:   affectedUser || null,
    status:          'open',
  }]);

  if (insertError) {
    console.error('Insert error:', insertError);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create ticket' }) };
  }

  // ── Send IT notification (non-blocking failure) ──
  try {
    await sendEmail(ticketId, { category, subType, priority, subject, description, requesterName, requesterEmail: emailNorm, department, location, affectedUser });
  } catch (emailErr) {
    // Log but don't fail — ticket is already created
    console.error('IT notification failed:', emailErr.message);
  }

  // ── Get-or-create the requester's portable token; email the link ──
  let confirmationSent = false;
  try {
    const token = await getOrCreateToken(supabase, emailNorm);
    const ticketLink = `${SITE_URL}/p/${token}/t/${ticketId}`;
    const portalLink = `${SITE_URL}/p/${token}`;
    await sendConfirmationEmail(ticketId, { subject, requesterName, requesterEmail: emailNorm }, ticketLink, portalLink);
    confirmationSent = true;
  } catch (confErr) {
    console.error('Confirmation email failed:', confErr.message);
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, ticketId, confirmationSent }),
  };
};

// ─────────────────────────────────────────────
// EMAIL TEMPLATE
// ─────────────────────────────────────────────
async function sendEmail(ticketId, ticket) {
  const catLabels = {
    access:   'Access Request',
    hardware: 'Hardware Request',
    account:  'Account Setup / Offboarding',
    support:  'General IT Support',
  };
  const priColors = {
    urgent: '#C0392B',
    high:   '#B45309',
    medium: '#1C64F2',
    low:    '#6B7280',
  };
  const priBg = {
    urgent: '#FDECEA',
    high:   '#FEF3C7',
    medium: '#EBF2FF',
    low:    '#F3F4F6',
  };

  const color  = priColors[ticket.priority] || '#6B7280';
  const bgCol  = priBg[ticket.priority]     || '#F3F4F6';
  const catStr = catLabels[ticket.category] || ticket.category;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.10);max-width:100%;">

      <!-- DARK HEADER -->
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

      <!-- TICKET ID BAND -->
      <tr>
        <td style="background:#EBF2FF;padding:14px 32px;border-bottom:1px solid #E2E8EF;">
          <span style="font-size:18px;font-weight:700;color:#1C64F2;letter-spacing:-0.02em;">${ticketId}</span>
          <span style="font-size:12px;color:#6B7280;margin-left:10px;">${catStr} — ${ticket.subType}</span>
        </td>
      </tr>

      <!-- SUBJECT -->
      <tr>
        <td style="padding:24px 32px 6px;">
          <div style="font-size:17px;font-weight:700;color:#0F1C2E;line-height:1.3;">${ticket.subject}</div>
        </td>
      </tr>

      <!-- DETAILS -->
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

      <!-- PRIORITY BANNER -->
      <tr>
        <td style="background:${bgCol};padding:12px 32px;border-top:1px solid #E2E8EF;">
          <span style="color:${color};font-size:12px;font-weight:600;">⚡ Priority: ${ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}</span>
          <span style="color:#6B7280;font-size:12px;margin-left:16px;">Log in to the IT Admin Dashboard to manage this ticket.</span>
        </td>
      </tr>

      <!-- FOOTER -->
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
  const toAddr   = process.env.IT_SUPPORT_EMAIL || 'itsupporttickets@hdsau.com.au';

  // SendGrid API — https://docs.sendgrid.com/api-reference/mail-send/mail-send
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      personalizations: [{
        to: [{ email: toAddr }],
      }],
      from: {
        email: fromAddr,
        name:  'HDS IT Helpdesk',
      },
      subject: `[${ticketId}] [${ticket.priority.toUpperCase()}] ${ticket.subject}`,
      content: [{
        type:  'text/html',
        value: html,
      }],
    }),
  });

  // SendGrid returns 202 Accepted on success (no response body)
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`SendGrid API ${res.status}: ${txt}`);
  }
}

// ─────────────────────────────────────────────
// CONFIRMATION EMAIL — to the requester, with a magic link
// ─────────────────────────────────────────────
function escEmail(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

async function sendConfirmationEmail(ticketId, ticket, magicLink, portalLink) {
  const firstName = (ticket.requesterName || '').split(' ')[0] || 'there';
  const fromAddr  = process.env.EMAIL_FROM || 'helpdesk@homedelivery.com.au';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#0F1C2E;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <tr><td style="padding:24px 28px 16px;border-bottom:1px solid #E2E8EF;">
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
    `Hi ${firstName},`,
    '',
    `We've received your IT ticket and the team has been notified.`,
    '',
    `Title: ${ticket.subject}`,
    `Reference: ${ticketId}`,
    '',
    `View your ticket (this link signs you in automatically):`,
    magicLink,
    '',
    `View all your tickets:`,
    portalLink,
    '',
    `After signing in once, you'll stay logged in for 30 days at ${SITE_URL}`,
    '',
    `— HDS IT Helpdesk`,
  ].join('\n');

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: ticket.requesterEmail, name: ticket.requesterName }] }],
      from: { email: fromAddr, name: 'HDS IT Helpdesk' },
      subject: `We received your IT ticket [${ticketId}]`,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html',  value: html },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`SendGrid API ${res.status}: ${txt}`);
  }
}

// ─────────────────────────────────────────────
// PORTABLE TOKEN — one permanent token per requester email
// ─────────────────────────────────────────────
async function getOrCreateToken(supabase, email) {
  const { data: existing } = await supabase
    .from('user_access_tokens')
    .select('token')
    .eq('user_email', email)
    .is('revoked_at', null)
    .maybeSingle();
  if (existing && existing.token) return existing.token;

  const token = crypto.randomBytes(18).toString('base64url');
  const { error } = await supabase
    .from('user_access_tokens')
    .upsert({ user_email: email, token }, { onConflict: 'user_email' });
  if (error) throw error;
  return token;
}
