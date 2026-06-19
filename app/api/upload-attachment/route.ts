/* Port of netlify/functions/upload-attachment.js — single image (base64 JSON,
   ≤2 MB) from a requester OR IT staff → private ticket-attachments bucket +
   ticket_attachments row (note_id null). Returns the row id + 1-hour signed URL.
   Auth: Bearer JWT; admin / dept-manager / the ticket's requester. */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'ticket-attachments';
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
  const accessToken = authHeader.slice(7);

  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  const callerEmail = (userData.user.email || '').toLowerCase();

  let body: { ticketId?: string; fileName?: string; mimeType?: string; dataBase64?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { ticketId, fileName, mimeType, dataBase64 } = body;

  if (!ticketId || !fileName || !mimeType || !dataBase64) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  if (!ALLOWED_MIME.includes(String(mimeType).toLowerCase())) return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 });

  const b64 = String(dataBase64).includes(',') ? String(dataBase64).split(',').pop()! : String(dataBase64);
  let buffer: Buffer;
  try { buffer = Buffer.from(b64, 'base64'); } catch { return NextResponse.json({ error: 'Invalid file data' }, { status: 400 }); }
  if (!buffer.length) return NextResponse.json({ error: 'Empty file' }, { status: 400 });
  if (buffer.length > MAX_BYTES) return NextResponse.json({ error: 'Image exceeds the 2 MB limit' }, { status: 400 });

  const { data: ticket, error: tErr } = await admin.from('tickets').select('id, requester_email, department').eq('id', ticketId).maybeSingle();
  if (tErr) return NextResponse.json({ error: 'Ticket lookup failed' }, { status: 500 });
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

  const { data: roleRow } = await admin.from('user_roles').select('role, department, full_name').eq('user_id', userData.user.id).maybeSingle();

  let uploadedBy: string;
  if (roleRow && roleRow.role === 'admin') {
    uploadedBy = roleRow.full_name || callerEmail;
  } else if (roleRow && roleRow.role === 'manager') {
    if (ticket.department !== roleRow.department) return NextResponse.json({ error: 'Outside your department' }, { status: 403 });
    uploadedBy = roleRow.full_name || callerEmail;
  } else if ((ticket.requester_email || '').toLowerCase() === callerEmail) {
    uploadedBy = callerEmail;
  } else {
    return NextResponse.json({ error: 'You do not have access to this ticket' }, { status: 403 });
  }

  const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const storagePath = `${ticket.id}/${Date.now()}-${safeName}`;

  const { error: upErr } = await admin.storage.from(BUCKET).upload(storagePath, buffer, { contentType: mimeType, upsert: false });
  if (upErr) return NextResponse.json({ error: 'Upload failed: ' + upErr.message }, { status: 500 });

  const { data: row, error: insErr } = await admin
    .from('ticket_attachments')
    .insert({ ticket_id: ticket.id, note_id: null, storage_path: storagePath, file_name: safeName, file_size: buffer.length, mime_type: mimeType, uploaded_by: uploadedBy })
    .select('id')
    .single();
  if (insErr) return NextResponse.json({ error: 'Could not record attachment: ' + insErr.message }, { status: 500 });

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, 3600);

  return NextResponse.json({ ok: true, attachmentId: row.id, signedUrl: signed?.signedUrl });
}
