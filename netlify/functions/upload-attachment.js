/* ═══════════════════════════════════════════════════════════════
   HDS IT HELPDESK — upload-attachment function

   Accepts a single image (base64 JSON, ≤2 MB) from a requester OR IT
   staff, stores it privately in the ticket-attachments bucket, records
   a ticket_attachments row (note_id null — the reply function links it
   to the new note), and returns the row id + a 1-hour signed URL.

   Auth: Authorization: Bearer <jwt>. Authorised if the caller is admin,
   a manager for the ticket's department, or the ticket's requester.

   2 MB fits comfortably under Netlify's ~6 MB function payload limit, so
   a per-image base64 POST is fine. Reuses the table/bucket/RLS created
   by migration-v1.2 — no new migration.
   ═══════════════════════════════════════════════════════════════ */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET                    = 'ticket-attachments';
const MAX_BYTES                 = 2 * 1024 * 1024;            // 2 MB
const ALLOWED_MIME              = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function res(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return res(405, { error: 'Method not allowed' });

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res(401, { error: 'Missing Authorization header' });
  const accessToken = authHeader.slice(7);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return res(401, { error: 'Invalid or expired session' });
  const callerEmail = (userData.user.email || '').toLowerCase();

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res(400, { error: 'Invalid JSON' }); }
  const { ticketId, fileName, mimeType, dataBase64 } = body;

  if (!ticketId || !fileName || !mimeType || !dataBase64) return res(400, { error: 'Missing fields' });
  if (!ALLOWED_MIME.includes(String(mimeType).toLowerCase())) return res(400, { error: 'Only image files are allowed' });

  // Decode + size-check server-side (never trust the client).
  const b64 = String(dataBase64).includes(',') ? String(dataBase64).split(',').pop() : String(dataBase64);
  let buffer;
  try { buffer = Buffer.from(b64, 'base64'); } catch { return res(400, { error: 'Invalid file data' }); }
  if (!buffer.length) return res(400, { error: 'Empty file' });
  if (buffer.length > MAX_BYTES) return res(400, { error: 'Image exceeds the 2 MB limit' });

  // Fetch the ticket and authorise the caller.
  const { data: ticket, error: tErr } = await admin
    .from('tickets').select('id, requester_email, department').eq('id', ticketId).maybeSingle();
  if (tErr) return res(500, { error: 'Ticket lookup failed' });
  if (!ticket) return res(404, { error: 'Ticket not found' });

  const { data: roleRow } = await admin
    .from('user_roles').select('role, department, full_name').eq('user_id', userData.user.id).maybeSingle();

  let uploadedBy;
  if (roleRow && roleRow.role === 'admin') {
    uploadedBy = roleRow.full_name || callerEmail;
  } else if (roleRow && roleRow.role === 'manager') {
    if (ticket.department !== roleRow.department) return res(403, { error: 'Outside your department' });
    uploadedBy = roleRow.full_name || callerEmail;
  } else if ((ticket.requester_email || '').toLowerCase() === callerEmail) {
    uploadedBy = callerEmail;
  } else {
    return res(403, { error: 'You do not have access to this ticket' });
  }

  // Store under {ticketId}/{timestamp}-{safe-name}
  const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const storagePath = `${ticket.id}/${Date.now()}-${safeName}`;

  const { error: upErr } = await admin.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: mimeType, upsert: false,
  });
  if (upErr) return res(500, { error: 'Upload failed: ' + upErr.message });

  const { data: row, error: insErr } = await admin
    .from('ticket_attachments')
    .insert({
      ticket_id:   ticket.id,
      note_id:     null,
      storage_path: storagePath,
      file_name:   safeName,
      file_size:   buffer.length,
      mime_type:   mimeType,
      uploaded_by: uploadedBy,
    })
    .select('id')
    .single();
  if (insErr) return res(500, { error: 'Could not record attachment: ' + insErr.message });

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, 3600);

  return res(200, { ok: true, attachmentId: row.id, signedUrl: signed && signed.signedUrl });
};
