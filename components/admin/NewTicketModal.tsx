'use client';

import { useRef, useState } from 'react';
import { sb } from '@/lib/supabase';
import { CAT_LABEL, PRI_LABEL, DEPARTMENTS, SUB_TYPES, ALLOWED_DOMAINS } from '@/lib/constants';
import type { AssignableUser } from '@/lib/users';
import { uploadImages } from '@/lib/attachments';
import { useToast } from '@/components/Toast';

const NOTIFY_ON = 'Requester gets a secure link to view and reply in the portal. The conversation moves onto the platform.';
const NOTIFY_OFF = 'No email sent — logged internally only. Use this for issues you’ve already handled or are tracking yourself.';
const NT_STATUS: [string, string][] = [['new', 'New'], ['in-progress', 'In Progress'], ['on-hold', 'On Hold'], ['resolved', 'Resolved']];

export function NewTicketModal({ users, me, onClose, onReload }: { users: AssignableUser[]; me: { name: string; email: string }; onClose: () => void; onReload: () => Promise<void> }) {
  const toast = useToast();
  const [subject, setSubject] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // "This is for me" — raise the ticket as the signed-in staff member rather than
  // on behalf of someone else. Prefills + locks the requester fields so the email
  // reliably matches the admin's own address (findable in the "My tickets" view).
  const [forMe, setForMe] = useState(false);
  const [dept, setDept] = useState('');
  const [affected, setAffected] = useState('');
  const [desc, setDesc] = useState('');
  const [category, setCategory] = useState('');
  const [subType, setSubType] = useState('');
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('in-progress');
  const [assign, setAssign] = useState('');
  const [notify, setNotify] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // "Draft from email" assist
  const [thread, setThread] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [drafted, setDrafted] = useState(false);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const hlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hl = (k: string) => (highlight.has(k) ? ' nt-filled' : '');

  function pickCategory(c: string) { setCategory(c); setSubType(''); }

  // Toggle "this is for me": ON prefills + locks the requester to the signed-in
  // user and defaults notify OFF (no point emailing yourself a portal link).
  // OFF restores the empty "raise on behalf of" defaults.
  function toggleForMe() {
    setForMe(v => {
      const next = !v;
      if (next) { setName(me.name || ''); setEmail(me.email || ''); setNotify(false); }
      else { setName(''); setEmail(''); setNotify(true); }
      return next;
    });
  }

  async function draft() {
    const t = thread.trim();
    if (!t) { toast('Paste an email thread first.'); return; }
    setDrafting(true); setDraftError('');
    try {
      const { data: { session } } = await sb.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Session expired — please sign in again.');
      const r = await fetch('/api/draft-ticket', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ thread: t }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || ('HTTP ' + r.status));
      const d = data.draft as Record<string, string>;
      const filled = new Set<string>();
      const apply = (key: string, val: string, fn: (v: string) => void) => { if (val && val.trim()) { fn(val.trim()); filled.add(key); } };
      apply('subject', d.subject, setSubject);
      apply('name', d.requester_name, setName);
      apply('email', d.requester_email, setEmail);
      apply('dept', d.department, setDept);
      apply('affected', d.affected_user, setAffected);
      apply('desc', d.description, setDesc);
      apply('category', d.category, setCategory);
      apply('subType', d.sub_type, setSubType);
      apply('priority', d.priority, setPriority);
      setDrafted(true);
      setHighlight(filled);
      if (hlTimer.current) clearTimeout(hlTimer.current);
      hlTimer.current = setTimeout(() => setHighlight(new Set()), 1800);
    } catch (err) {
      // A failed draft must never block manual entry — just surface a note.
      setDraftError((err as Error).message || 'Draft failed — please fill the form manually.');
    } finally {
      setDrafting(false);
    }
  }

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
    if (!category) { toast('Pick a category.'); return; }

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
          // Keep the pasted thread (if any) as the ticket's first internal note.
          sourceThread: thread.trim() || undefined,
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
          {/* AI assist — paste a thread, Claude drafts the fields (never creates) */}
          <div className="nt-draft">
            <div className="nt-draft-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></svg>
              Draft from email
            </div>
            <textarea className="nt-input" value={thread} onChange={(e) => setThread(e.target.value)} placeholder="Paste the full email thread here, then click Draft from email — the fields below fill in as editable suggestions." />
            <div className="nt-draft-actions">
              <button type="button" className="btn-draft" onClick={draft} disabled={drafting || !thread.trim()}>
                {drafting
                  ? 'Reading thread…'
                  : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></svg> Draft from email</>}
              </button>
              {draftError && <span className="nt-draft-err">{draftError}</span>}
            </div>
          </div>

          {drafted && (
            <div className="nt-draft-banner">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
              Drafted from the email — review and edit every field before creating. Nothing is saved until you click Create.
            </div>
          )}

          <div className="nt-field">
            <label className="nt-label">Subject <span className="req">*</span></label>
            <input className={'nt-input' + hl('subject')} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="One-line summary of the request" autoFocus />
          </div>

          <div className="nt-group">
            <div className="nt-group-label">Requester</div>
            <div className="nt-notify" style={{ marginBottom: 12 }}>
              <div className="nt-notify-head">
                <span className="nt-notify-label">This is for me</span>
                <button type="button" className={`nt-toggle${forMe ? ' on' : ''}`} onClick={toggleForMe} aria-label="Toggle this is for me" />
              </div>
              <div className="nt-notify-help">{forMe ? 'Raising this ticket as yourself. Requester is set to your account, and it’ll show under “My tickets”.' : 'Off. Raising on behalf of someone else. Turn it on to log a ticket for yourself.'}</div>
            </div>
            <div className="nt-field">
              <label className="nt-label">Name <span className="req">*</span></label>
              <input className={'nt-input' + hl('name')} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jase Paul" autoComplete="off" disabled={forMe} style={forMe ? { background: '#EEF0F3', color: '#6B7280', cursor: 'not-allowed' } : undefined} />
            </div>
            <div className="nt-field">
              <label className="nt-label">Email <span className="req">*</span></label>
              <input className={'nt-input' + hl('email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@homedelivery.com.au" autoComplete="off" disabled={forMe} style={forMe ? { background: '#EEF0F3', color: '#6B7280', cursor: 'not-allowed' } : undefined} />
              <div className="nt-hint">{forMe ? 'Locked to your account while “This is for me” is on.' : 'Use the requester’s HDS work email (@homedelivery.com.au or @hdsau.com).'}</div>
            </div>
            <div className="nt-row-2">
              <div className="nt-field">
                <label className="nt-label">Department</label>
                <select className={'nt-input' + hl('dept')} value={dept} onChange={(e) => setDept(e.target.value)}><option value="">—</option>{DEPARTMENTS.map(d => <option key={d}>{d}</option>)}</select>
              </div>
              <div className="nt-field">
                <label className="nt-label">Affected user</label>
                <input className={'nt-input' + hl('affected')} value={affected} onChange={(e) => setAffected(e.target.value)} placeholder="If different" />
              </div>
            </div>
          </div>

          <div className="nt-group">
            <div className="nt-group-label">Description</div>
            <div className="nt-field">
              <textarea className={'nt-input' + hl('desc')} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What's the issue or request? Paste any relevant context here." />
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
              <select className={'nt-input' + hl('category')} value={category} onChange={(e) => pickCategory(e.target.value)}><option value="">—</option>{Object.entries(CAT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </div>
            <div className="nt-row-2">
              <div className="nt-field">
                <label className="nt-label">Sub-type</label>
                <select className={'nt-input' + hl('subType')} value={subType} onChange={(e) => setSubType(e.target.value)}><option value="">—</option>{(SUB_TYPES[category] || []).map(s => <option key={s}>{s}</option>)}</select>
              </div>
              <div className="nt-field">
                <label className="nt-label">Priority</label>
                <select className={'nt-input' + hl('priority')} value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">—</option>{['low', 'medium', 'high', 'urgent'].map(p => <option key={p} value={p}>{PRI_LABEL[p]}</option>)}</select>
              </div>
            </div>
          </div>

          <div className="nt-group">
            <div className="nt-group-label">Handling</div>
            <div className="nt-row-2">
              <div className="nt-field">
                <label className="nt-label">Assign to</label>
                <select className="nt-input" value={assign} onChange={(e) => setAssign(e.target.value)}><option value="">Unassigned</option>{users.map(u => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}</select>
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
