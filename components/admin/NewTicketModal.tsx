'use client';

import { useRef, useState } from 'react';
import { sb } from '@/lib/supabase';
import { CAT_LABEL, PRI_LABEL, DEPARTMENTS, IT_TEAM, SUB_TYPES, ALLOWED_DOMAINS } from '@/lib/constants';
import { uploadImages } from '@/lib/attachments';
import { useToast } from '@/components/Toast';

const NOTIFY_ON = 'Requester gets a secure link to view and reply in the portal. The conversation moves onto the platform.';
const NOTIFY_OFF = 'No email sent — logged internally only. Use this for issues you’ve already handled or are tracking yourself.';
const NT_STATUS: [string, string][] = [['open', 'Open'], ['in-progress', 'In Progress'], ['on-hold', 'On Hold'], ['resolved', 'Resolved']];

export function NewTicketModal({ onClose, onReload }: { onClose: () => void; onReload: () => Promise<void> }) {
  const toast = useToast();
  const [subject, setSubject] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dept, setDept] = useState('');
  const [affected, setAffected] = useState('');
  const [desc, setDesc] = useState('');
  const [category, setCategory] = useState('access');
  const [subType, setSubType] = useState(SUB_TYPES['access'][0]);
  const [priority, setPriority] = useState('medium');
  const [status, setStatus] = useState('in-progress');
  const [assign, setAssign] = useState('');
  const [notify, setNotify] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function pickCategory(c: string) { setCategory(c); setSubType((SUB_TYPES[c] || [''])[0] || ''); }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= 3) { toast('You can attach up to 3 images.'); break; }
      if (!f.type.startsWith('image/')) { toast('Images only.'); continue; }
      if (f.size > 2 * 1024 * 1024) { toast(`"${f.name}" is over the 2 MB limit.`); continue; }
      next.push(f);
    }
    setFiles(next);
  }

  async function submit() {
    const e = email.trim();
    if (!subject.trim()) { toast('Subject is required.'); return; }
    if (!name.trim()) { toast('Requester name is required.'); return; }
    if (!e || !e.includes('@')) { toast('A valid requester email is required.'); return; }
    if (!ALLOWED_DOMAINS.includes((e.split('@')[1] || '').toLowerCase())) { toast('Use an HDS email — @homedelivery.com.au or @hdsau.com.'); return; }

    setBusy(true);
    try {
      const { data: { session } } = await sb.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Session expired — please sign in again.');
      const r = await fetch('/api/create-ticket', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          subject: subject.trim(), requesterName: name.trim(), requesterEmail: e, category, subType,
          department: dept, affectedUser: affected.trim(), priority, description: desc.trim(), status, assignedTo: assign, notify,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));

      let imgWarn = false;
      if (files.length) {
        try { await uploadImages(data.ticketId, files); } catch { imgWarn = true; }
      }
      onClose();
      toast(`Ticket ${data.ticketId} created${data.notified ? ' · requester notified' : ''}${imgWarn ? ' (image upload failed)' : ''}.`);
      await onReload();
    } catch (err) {
      toast('Failed: ' + (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="nt-overlay open" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="nt-modal">
        <div className="nt-head">
          <div>
            <div className="nt-title">New ticket</div>
            <div className="nt-sub">Raise a ticket on behalf of a requester</div>
          </div>
          <button className="nt-close" onClick={onClose} aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>

        <div className="nt-body">
          <div className="nt-field">
            <label className="nt-label">Subject <span className="req">*</span></label>
            <input className="nt-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="One-line summary of the request" autoFocus />
          </div>

          <div className="nt-group">
            <div className="nt-group-label">Requester</div>
            <div className="nt-field">
              <label className="nt-label">Name <span className="req">*</span></label>
              <input className="nt-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jase Paul" autoComplete="off" />
            </div>
            <div className="nt-field">
              <label className="nt-label">Email <span className="req">*</span></label>
              <input className="nt-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@homedelivery.com.au" autoComplete="off" />
              <div className="nt-hint">Use the requester&apos;s HDS work email (@homedelivery.com.au or @hdsau.com).</div>
            </div>
            <div className="nt-row-2">
              <div className="nt-field">
                <label className="nt-label">Department</label>
                <select className="nt-input" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">Select…</option>{DEPARTMENTS.map(d => <option key={d}>{d}</option>)}</select>
              </div>
              <div className="nt-field">
                <label className="nt-label">Affected user</label>
                <input className="nt-input" value={affected} onChange={(e) => setAffected(e.target.value)} placeholder="If different" />
              </div>
            </div>
          </div>

          <div className="nt-group">
            <div className="nt-group-label">Description</div>
            <div className="nt-field">
              <textarea className="nt-input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What's the issue or request? Paste any relevant context here." />
            </div>
            <button type="button" className="nt-btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '7px 12px' }} onClick={() => fileRef.current?.click()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg> Attach images
            </button>
            {files.length > 0 && <div className="attach-preview">{files.map((f, i) => <span key={i} className="attach-chip"><span>{f.name}</span><button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove">×</button></span>)}</div>}
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>

          <div className="nt-group">
            <div className="nt-group-label">Classification</div>
            <div className="nt-field">
              <label className="nt-label">Category <span className="req">*</span></label>
              <select className="nt-input" value={category} onChange={(e) => pickCategory(e.target.value)}>{Object.entries(CAT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </div>
            <div className="nt-row-2">
              <div className="nt-field">
                <label className="nt-label">Sub-type</label>
                <select className="nt-input" value={subType} onChange={(e) => setSubType(e.target.value)}>{(SUB_TYPES[category] || []).map(s => <option key={s}>{s}</option>)}</select>
              </div>
              <div className="nt-field">
                <label className="nt-label">Priority</label>
                <select className="nt-input" value={priority} onChange={(e) => setPriority(e.target.value)}>{['low', 'medium', 'high', 'urgent'].map(p => <option key={p} value={p}>{PRI_LABEL[p]}</option>)}</select>
              </div>
            </div>
          </div>

          <div className="nt-group">
            <div className="nt-group-label">Handling</div>
            <div className="nt-row-2">
              <div className="nt-field">
                <label className="nt-label">Assign to</label>
                <select className="nt-input" value={assign} onChange={(e) => setAssign(e.target.value)}><option value="">Unassigned</option>{IT_TEAM.map(m => <option key={m}>{m}</option>)}</select>
              </div>
              <div className="nt-field">
                <label className="nt-label">Initial status</label>
                <select className="nt-input" value={status} onChange={(e) => setStatus(e.target.value)}>{NT_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </div>
            </div>
            <div className="nt-notify">
              <div className="nt-notify-head">
                <span className="nt-notify-label">Notify requester</span>
                <button type="button" className={`nt-toggle${notify ? ' on' : ''}`} onClick={() => setNotify(v => !v)} aria-label="Toggle notify" />
              </div>
              <div className="nt-notify-help">{notify ? NOTIFY_ON : NOTIFY_OFF}</div>
            </div>
          </div>
        </div>

        <div className="nt-foot">
          <button className="nt-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="nt-btn-primary" onClick={submit} disabled={busy}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg> {busy ? 'Creating…' : 'Create ticket'}</button>
        </div>
      </div>
    </div>
  );
}
