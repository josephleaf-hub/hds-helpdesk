// Image attachment helpers — ported from shared.js. Client-side only.
import { sb } from './supabase';
import type { AttachMap } from './types';

const BUCKET = 'ticket-attachments';

// Fetch a ticket's attachments (RLS-scoped) and group 1-hour signed URLs by note_id.
// Ticket-level images (note_id null) land under the '_unlinked' key.
export async function loadAttachmentMap(ticketId: string): Promise<AttachMap> {
  const map: AttachMap = {};
  const { data, error } = await sb.from('ticket_attachments').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
  if (error || !data) return map;
  for (const a of data) {
    let url = '';
    try {
      const { data: s } = await sb.storage.from(BUCKET).createSignedUrl(a.storage_path, 3600);
      url = s?.signedUrl || '';
    } catch { /* skip unsignable */ }
    if (!url) continue;
    const key = a.note_id || '_unlinked';
    (map[key] = map[key] || []).push({ url, name: a.file_name, mime: a.mime_type });
  }
  return map;
}

// Read a File as base64 (strips the data: prefix) for JSON upload.
export function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',').pop() || '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export interface CompressedImage { dataBase64: string; mimeType: string; fileName: string; }

// Downscale + re-encode an image File to a JPEG base64 string. Falls back to the
// original bytes if canvas encoding fails.
export function compressImageToBase64(file: File, maxDim = 1600, quality = 0.82): Promise<CompressedImage | null> {
  return new Promise((resolve) => {
    const fail = () => {
      const r = new FileReader();
      r.onload = () => resolve({ dataBase64: String(r.result).split(',').pop() || '', mimeType: file.type || 'image/jpeg', fileName: file.name || 'image' });
      r.onerror = () => resolve(null);
      r.readAsDataURL(file);
    };
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          try {
            let w = img.width, h = img.height;
            if (Math.max(w, h) > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d')!.drawImage(img, 0, 0, w, h);
            const out = c.toDataURL('image/jpeg', quality);
            resolve({ dataBase64: out.split(',').pop() || '', mimeType: 'image/jpeg', fileName: (file.name || 'image').replace(/\.\w+$/, '') + '.jpg' });
          } catch { fail(); }
        };
        img.onerror = fail;
        img.src = String(reader.result);
      };
      reader.onerror = fail;
      reader.readAsDataURL(file);
    } catch { fail(); }
  });
}

// Upload images to a ticket via /api/upload-attachment; returns the new attachment IDs.
export async function uploadImages(ticketId: string, files: File[]): Promise<string[]> {
  if (!files || !files.length) return [];
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Session expired — please sign in again.');
  const ids: string[] = [];
  for (const f of files) {
    const dataBase64 = await readFileBase64(f);
    const res = await fetch('/api/upload-attachment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ ticketId, fileName: f.name, mimeType: f.type, dataBase64 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    ids.push(data.attachmentId);
  }
  return ids;
}
