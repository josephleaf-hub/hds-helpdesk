/* ═══════════════════════════════════════════════════════════════
   HDS IT Helpdesk — shared front-end core (Stage 0)
   Loaded by admin.html and index.html BEFORE each page's own <script>.
   Requires window.HDS_CONFIG (config.js) and window.supabase (CDN) to
   have loaded first.

   Holds the page-agnostic pieces both the admin dashboard and the staff
   portal use, so they stay in lockstep: the Supabase client factory,
   string/date helpers, the label/config maps, badge + toast helpers, and
   the shared conversation renderer.
   ═══════════════════════════════════════════════════════════════ */

// ── Supabase browser client (anon key; session persists in localStorage) ──
function createHdsClient() {
  return window.supabase.createClient(
    window.HDS_CONFIG.SUPABASE_URL,
    window.HDS_CONFIG.SUPABASE_ANON_KEY
  );
}

// ── Config maps ──
const CAT_LABEL    = { access:'Access Request', hardware:'Hardware Request', account:'Account Setup', support:'IT Support' };
const STATUS_LABEL = { open:'Open','in-progress':'In Progress','waiting-on-admin':'Waiting on Admin','waiting-on-requester':'Waiting on Requester','on-hold':'On Hold',resolved:'Resolved',closed:'Closed' };
const PRI_LABEL    = { low:'Low',medium:'Medium',high:'High',urgent:'Urgent' };
const IT_TEAM      = ['IT Level 1','IT Level 2','Senior Engineer','IT Manager'];
const DEPARTMENTS  = ['Operations','Technology','Finance','Sales','Customer Service','HR & People','Leadership','Marketing','Warehouse','Driver / Field'];

// ── String + date helpers ──
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function fmtShort(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric' });
}

// ── Badges ──
function statusBadge(s, labels) {
  const cls = { open:'b-open','in-progress':'b-progress','waiting-on-admin':'b-waiting-admin','waiting-on-requester':'b-waiting','on-hold':'b-hold',resolved:'b-resolved',closed:'b-closed' };
  const L = labels || STATUS_LABEL;
  return `<span class="badge ${cls[s]||'b-hold'}">${L[s]||s}</span>`;
}
function priBadge(p) {
  const cls  = { low:'b-low',medium:'b-medium',high:'b-high',urgent:'b-urgent' };
  const cols = { low:'#9CA3AF',medium:'#1C64F2',high:'#B45309',urgent:'#C0392B' };
  return `<span class="badge ${cls[p]||'b-low'}"><span class="pri-dot" style="background:${cols[p]||'#9CA3AF'};"></span>${PRI_LABEL[p]||p}</span>`;
}

// ── Button loading state ──
// Swap a button into a spinner + label while an async action runs, then restore.
// Preserves the original markup (icon + text) so multi-state buttons come back clean.
function setBtnLoading(btn, loading, label) {
  if (!btn) return;
  if (loading) {
    if (btn.dataset.origHtml == null) btn.dataset.origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span>${label ? esc(label) : ''}`;
  } else {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    if (btn.dataset.origHtml != null) { btn.innerHTML = btn.dataset.origHtml; delete btn.dataset.origHtml; }
  }
}

// ── Toast (expects a <div id="toast"> on the page) ──
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}

// ── Conversation renderer (admin modal + portal render identically) ──
const NOTE_STYLE = {
  outbound: { color:'#1C64F2', bg:'#EBF2FF', border:'#1C64F2',
              icon:'<polyline points="22 2 15 22 11 13 2 9 22 2"/>' },
  inbound:  { color:'#C24824', bg:'#FFF3EF', border:'#FF6B43',
              icon:'<polyline points="2 22 9 15 13 11 22 2"/><line x1="22" y1="2" x2="11" y2="13"/>' },
  internal: { color:'#6B7280', bg:'#F8F9FA', border:'#C8D4DF',
              icon:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
};
function noteIcon(paths, color) {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;flex-shrink:0;margin-right:5px;color:${color};">${paths}</svg>`;
}
// `reqFirst` = requester's first name (already escaped). outbound/inbound
// carry the requester's name; internal notes are labelled 'Internal note'.
function renderConversation(notes, reqFirst, attMap) {
  attMap = attMap || {};
  if (!notes || !notes.length) {
    return '<div style="color:#9CA3AF;font-size:12px;font-style:italic;margin-bottom:8px;">No conversation yet.</div>';
  }
  const labelFor = (type) =>
    type === 'outbound' ? `Sent to ${reqFirst}` :
    type === 'inbound'  ? `Reply from ${reqFirst}` : 'Internal note';
  return notes.map(n => {
    const s = NOTE_STYLE[n.note_type] || NOTE_STYLE.internal;
    const textHtml = n.note_text ? `<div class="note-text" style="margin-top:4px;">${esc(n.note_text)}</div>` : '';
    return `
        <div class="note-item" style="background:${s.bg};border-left:3px solid ${s.border};padding:10px 12px;border-radius:6px;margin-bottom:8px;">
          <div class="note-meta" style="color:${s.color};font-weight:600;">${noteIcon(s.icon,s.color)} ${labelFor(n.note_type)} · <span style="color:#6B7280;font-weight:500;">${esc(n.added_by)} · ${fmtDate(n.created_at)}</span></div>
          ${textHtml}
          ${attachmentThumbs(attMap[n.id])}
        </div>`;
  }).join('');
}

// ── Image attachments ──────────────────────────
function attachmentThumbs(list) {
  if (!list || !list.length) return '';
  return '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">' + list.map(a =>
    `<a href="${a.url}" target="_blank" rel="noopener" title="${esc(a.name)}"><img src="${a.url}" alt="${esc(a.name)}" style="height:74px;width:74px;object-fit:cover;border-radius:8px;border:1px solid #C8D4DF;display:block;"></a>`
  ).join('') + '</div>';
}

// Fetch a ticket's attachments (RLS-scoped) and group 1-hour signed URLs by note_id.
async function loadAttachmentMap(sb, ticketId) {
  const map = {};
  const { data, error } = await sb.from('ticket_attachments').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
  if (error || !data) return map;
  for (const a of data) {
    let url = '';
    try {
      const { data: s } = await sb.storage.from('ticket-attachments').createSignedUrl(a.storage_path, 3600);
      url = (s && s.signedUrl) || '';
    } catch (_) { /* skip unsignable */ }
    if (!url) continue;
    const key = a.note_id || '_unlinked';
    (map[key] = map[key] || []).push({ url, name: a.file_name, mime: a.mime_type });
  }
  return map;
}

// Downscale + re-encode an image File to a JPEG base64 string (no data: prefix).
// Keeps a submit request small enough for the 6 MB serverless payload limit.
// Falls back to the original bytes if canvas encoding fails for any reason.
function compressImageToBase64(file, maxDim, quality) {
  maxDim = maxDim || 1600; quality = quality || 0.82;
  return new Promise((resolve) => {
    const fail = () => {
      const r = new FileReader();
      r.onload = () => resolve({ dataBase64: String(r.result).split(',').pop(), mimeType: file.type || 'image/jpeg', fileName: file.name || 'image' });
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
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            const out = c.toDataURL('image/jpeg', quality);
            resolve({ dataBase64: out.split(',').pop(), mimeType: 'image/jpeg', fileName: (file.name || 'image').replace(/\.\w+$/, '') + '.jpg' });
          } catch (_) { fail(); }
        };
        img.onerror = fail;
        img.src = reader.result;
      };
      reader.onerror = fail;
      reader.readAsDataURL(file);
    } catch (_) { fail(); }
  });
}

// Read a File as base64 (strips the data: prefix) for JSON upload.
function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',').pop());
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Upload images for a ticket; returns the new attachment IDs to link to a note.
async function uploadImages(sb, ticketId, files) {
  if (!files || !files.length) return [];
  const { data: { session } } = await sb.auth.getSession();
  const token = session && session.access_token;
  if (!token) throw new Error('Session expired — please sign in again.');
  const ids = [];
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
