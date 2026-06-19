'use client';

import { useEffect, useRef, useState } from 'react';
import { sb } from '@/lib/supabase';
import { CAT_LABEL, STATUS_LABEL, PRI_LABEL, IT_TEAM } from '@/lib/constants';
import { fmtDate } from '@/lib/format';
import { loadAttachmentMap, uploadImages } from '@/lib/attachments';
import { Conversation } from '@/components/Conversation';
import { FloatingMenu, MenuItem } from '@/components/admin/FloatingMenu';
import { useToast } from '@/components/Toast';
import type { Ticket, Note, AttachMap } from '@/lib/types';

type AdminUser = { id: string; email: string; role: 'admin' | 'manager'; department: string | null; full_name: string };
type Tab = 'reply' | 'internal' | 'log';

const ST_CLS: Record<string, string> = { open: 'b-open', 'in-progress': 'b-progress', 'waiting-on-requester': 'b-waiting', 'waiting-on-admin': 'b-hold', 'on-hold': 'b-hold', resolved: 'b-resolved', closed: 'b-closed' };
const PR_CLS: Record<string, string> = { low: 'b-low', medium: 'b-medium', high: 'b-high', urgent: 'b-urgent' };
const Chev = () => <svg className="chev ico" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>;
const SendIco = () => <svg className="ico" width="13" height="13" viewBox="0 0 24 24"><polyline points="22 2 15 22 11 13 2 9 22 2" /></svg>;
const Paperclip = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -2 }}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>;

export function EditModal({ ticket, user, onClose, onReload, patchTicket }: {
  ticket: Ticket; user: AdminUser; onClose: () => void;
  onReload: () => Promise<void>; patchTicket: (id: string, partial: Partial<Ticket>) => void;
}) {
  const toast = useToast();
  const [attMap, setAttMap] = useState<AttachMap>({});
  const [tab, setTab] = useState<Tab>('reply');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [statusRadio, setStatusRadio] = useState('');
  const [pane, setPane] = useState<'chat' | 'ticket'>('chat');
  const [pill, setPill] = useState<{ field: 'status' | 'priority' | 'assigned'; rect: DOMRect } | null>(null);
  const [busy, setBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const convRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const prevCount = useRef(0);

  const notes: Note[] = (ticket.ticket_notes || []).slice().sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
  const reqFirst = (ticket.requester_name || '').split(' ')[0] || 'requester';

  // Pull the attachment map whenever the ticket or its note count changes.
  useEffect(() => {
    let on = true;
    loadAttachmentMap(ticket.id).then(m => { if (on) setAttMap(m); });
    return () => { on = false; };
  }, [ticket.id, notes.length]);

  // Auto-scroll to newest message on open and when a new note arrives.
  useEffect(() => {
    const c = convRef.current;
    if (c && (notes.length > prevCount.current || prevCount.current === 0)) c.scrollTop = c.scrollHeight;
    prevCount.current = notes.length;
  }, [notes.length, attMap]);

  // Escape closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pill) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, pill]);

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

  async function submitComposer() {
    const msg = text.trim();
    if (!msg && !files.length) { toast('Type something or attach an image first.'); return; }
    const newStatus = statusRadio || null;
    setBusy(true);
    try {
      const attachmentIds = await uploadImages(ticket.id, files);
      if (tab === 'reply' || tab === 'log') {
        const { data: { session } } = await sb.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error('Session expired — please sign in again.');
        const res = await fetch('/api/send-message', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ ticketId: ticket.id, message: msg, direction: tab === 'reply' ? 'outbound' : 'inbound', newStatus, attachmentIds }),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(result.error || ('HTTP ' + res.status));
        toast(tab === 'reply' ? 'Reply sent to requester.' : 'Reply logged against ticket.');
      } else {
        // Internal note — direct insert (no email).
        const { data: noteRow, error: noteErr } = await sb.from('ticket_notes').insert({
          ticket_id: ticket.id, added_by: user.full_name || user.email, note_text: msg, note_type: 'internal',
        }).select('id').single();
        if (noteErr) throw noteErr;
        if (attachmentIds.length) {
          await sb.from('ticket_attachments').update({ note_id: noteRow.id })
            .eq('ticket_id', ticket.id).is('note_id', null).in('id', attachmentIds);
        }
        if (newStatus) {
          const update: Partial<Ticket> = { status: newStatus as Ticket['status'] };
          if (newStatus === 'resolved' || newStatus === 'closed') update.resolved_at = new Date().toISOString();
          const { error: tErr } = await sb.from('tickets').update(update).eq('id', ticket.id);
          if (tErr) throw tErr;
        }
        toast('Internal note added');
      }
      setText(''); setFiles([]); setStatusRadio('');
      await onReload();
    } catch (err) {
      toast('Failed: ' + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openPill(field: 'status' | 'priority' | 'assigned', e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPill(p => (p && p.field === field) ? null : { field, rect });
  }

  async function updateField(field: 'status' | 'priority' | 'assigned', value: string) {
    setPill(null);
    const column = field === 'assigned' ? 'assigned_to' : field;
    const val = field === 'assigned' ? (value || null) : value;
    const partial: Partial<Ticket> = { [column]: val } as Partial<Ticket>;
    if (field === 'status' && (value === 'resolved' || value === 'closed')) partial.resolved_at = new Date().toISOString();
    patchTicket(ticket.id, partial);   // optimistic — repaints pills/table/KPIs instantly
    try {
      const { error } = await sb.from('tickets').update(partial).eq('id', ticket.id);
      if (error) throw error;
      toast(`${field === 'assigned' ? 'Assignee' : field === 'status' ? 'Status' : 'Priority'} updated`);
    } catch (err) {
      toast('Failed: ' + (err as Error).message);
      await onReload();   // revert optimistic change
    }
  }

  async function refresh() {
    setRefreshBusy(true);
    try { await onReload(); setAttMap(await loadAttachmentMap(ticket.id)); }
    catch (err) { toast('Refresh failed: ' + (err as Error).message); }
    finally { setRefreshBusy(false); }
  }

  async function toggleArchive() {
    if (user.role !== 'admin') { toast('Only admins can archive tickets.'); return; }
    const archiving = !ticket.deleted_at;
    if (archiving && !window.confirm(`Archive ticket ${ticket.id}?\n\nIt will be hidden from the list and the KPIs, but kept on record with its full conversation. You can restore it any time from "Show archived".`)) return;
    setArchiveBusy(true);
    try {
      const { error } = await sb.from('tickets').update({ deleted_at: archiving ? new Date().toISOString() : null }).eq('id', ticket.id);
      if (error) throw error;
      toast(archiving ? `Ticket ${ticket.id} archived.` : `Ticket ${ticket.id} restored.`);
      onClose();
      await onReload();
    } catch (err) {
      toast('Failed: ' + (err as Error).message);
      setArchiveBusy(false);
    }
  }

  // ── Pill menu options ──
  const pillItems = (): MenuItem[] => {
    if (!pill) return [];
    if (pill.field === 'status') return Object.entries(STATUS_LABEL).map(([v, l]) => ({ label: l, selected: ticket.status === v, onClick: () => updateField('status', v) }));
    if (pill.field === 'priority') return Object.entries(PRI_LABEL).map(([v, l]) => ({ label: l, selected: ticket.priority === v, onClick: () => updateField('priority', v) }));
    return [{ label: 'Unassigned', selected: !ticket.assigned_to, onClick: () => updateField('assigned', '') }, ...IT_TEAM.map(m => ({ label: m, selected: ticket.assigned_to === m, onClick: () => updateField('assigned', m) }))];
  };

  const composeMeta = tab === 'internal' ? 'Visible to IT team only — does not email the requester'
    : tab === 'log' ? 'Logging a reply that came via email — no email will be sent'
    : <>Email sent from <strong>helpdesk@homedelivery.com.au</strong> to <strong>{ticket.requester_email}</strong> · they can reply directly to it</>;
  const sendLabel = busy ? (tab === 'internal' ? 'Saving…' : tab === 'log' ? 'Logging…' : 'Sending…')
    : tab === 'internal' ? 'Add Internal Note' : tab === 'log' ? 'Log Reply' : <>Send Email Reply <SendIco /></>;
  const placeholder = tab === 'internal' ? 'Add an internal note (IT team only)…' : tab === 'log' ? `Paste ${reqFirst}'s emailed reply…` : `Type your reply to ${reqFirst}…`;

  return (
    <>
      <div className="modal-overlay open" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="modal">
          <div className="modal-header">
            <div>
              <div className="modal-title">{ticket.subject}</div>
              <div className="modal-ticket-id">{ticket.id} · {(CAT_LABEL[ticket.category] || ticket.category)} — {ticket.sub_type} · Submitted {fmtDate(ticket.created_at)}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <button className="btn-secondary" style={{ fontSize: 12 }} onClick={refresh} disabled={refreshBusy} title="Refresh this ticket">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>{refreshBusy ? 'Refreshing…' : 'Refresh'}
              </button>
              <button className="modal-close" onClick={onClose}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -2, flexShrink: 0 }}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
            </div>
          </div>

          <div className="modal-body">
            <div className="h-mobile-tabs" role="tablist">
              <button type="button" className={`hmt-btn${pane === 'chat' ? ' active' : ''}`} onClick={() => setPane('chat')}>Conversation</button>
              <button type="button" className={`hmt-btn${pane === 'ticket' ? ' active' : ''}`} onClick={() => setPane('ticket')}>Ticket details</button>
            </div>
            <div className={`h-body ${pane === 'chat' ? 'show-chat' : 'show-ticket'}`}>

              {/* LEFT: read-only ticket context */}
              <div className="h-left">
                <div className="field">
                  <div className="field-label">Requester</div>
                  <div className="field-val">{ticket.requester_name}</div>
                  <div className="field-sub">{ticket.requester_email}</div>
                </div>
                <div className="field">
                  <div className="field-label">Department / Location</div>
                  <div className="field-val">{ticket.department}{ticket.location ? ' · ' + ticket.location : ''}</div>
                </div>
                <hr className="divider-line" />
                <div className="field">
                  <div className="field-label">Description</div>
                  <div className="desc-block">{ticket.description}</div>
                </div>
                <hr className="divider-line" />
                <div className="field">
                  <div className="field-label">Submitted</div>
                  <div className="field-val">{fmtDate(ticket.created_at)}</div>
                </div>
                {ticket.affected_user && (
                  <div className="field">
                    <div className="field-label">Affected user</div>
                    <div className="field-val">{ticket.affected_user}</div>
                  </div>
                )}
                {ticket.resolved_at && (
                  <div className="field">
                    <div className="field-label">Resolved at</div>
                    <div className="field-val">{fmtDate(ticket.resolved_at)}</div>
                  </div>
                )}
                {attMap['_unlinked']?.length ? (<>
                  <hr className="divider-line" />
                  <div className="field">
                    <div className="field-label">Submitted photo</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                      {attMap['_unlinked'].map((a, i) => <a key={i} href={a.url} target="_blank" rel="noopener" title={a.name}><img src={a.url} alt={a.name} style={{ height: 74, width: 74, objectFit: 'cover', borderRadius: 8, border: '1px solid #C8D4DF', display: 'block' }} /></a>)}
                    </div>
                  </div>
                </>) : null}
              </div>

              {/* RIGHT: pills + conversation + sticky composer */}
              <div className="h-right">
                <div className="pills-strip">
                  <span className="pill-label">Status</span>
                  <button className={`pill ${ST_CLS[ticket.status] || 'b-hold'}`} onClick={(e) => openPill('status', e)}>{STATUS_LABEL[ticket.status] || ticket.status}<Chev /></button>
                  <span className="pill-label" style={{ marginLeft: 8 }}>Priority</span>
                  <button className={`pill ${PR_CLS[ticket.priority] || 'b-low'}`} onClick={(e) => openPill('priority', e)}>{PRI_LABEL[ticket.priority] || ticket.priority}<Chev /></button>
                  <span className="pill-label" style={{ marginLeft: 8 }}>Assigned</span>
                  <button className={`pill ${ticket.assigned_to ? 'b-hold' : 'p-unassigned'}`} onClick={(e) => openPill('assigned', e)}>{ticket.assigned_to || 'Unassigned'}<Chev /></button>
                </div>

                <div className="conv-scroll" ref={convRef}>
                  <Conversation notes={notes} reqFirst={reqFirst} attMap={attMap} />
                </div>

                <div className="composer">
                  <div className="compose-tabs">
                    <button className={`compose-tab tab-reply${tab === 'reply' ? ' active' : ''}`} onClick={() => setTab('reply')}><SendIco /> Reply to {reqFirst}</button>
                    <button className={`compose-tab tab-internal${tab === 'internal' ? ' active' : ''}`} onClick={() => setTab('internal')}><svg className="ico" width="13" height="13" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg> Internal note</button>
                    <button className={`compose-tab tab-log${tab === 'log' ? ' active' : ''}`} onClick={() => setTab('log')}><svg className="ico" width="13" height="13" viewBox="0 0 24 24"><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></svg> Log their email reply</button>
                  </div>
                  <div className="compose-meta">{composeMeta}</div>
                  <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
                  {files.length > 0 && <div className="attach-preview">{files.map((f, i) => <span key={i} className="attach-chip"><span>{f.name}</span><button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove">×</button></span>)}</div>}
                  <div className="compose-actions">
                    <div className="status-radio-row">
                      <span className="label-strong">Status:</span>
                      {[['', 'No change'], ['waiting-on-requester', 'On requester'], ['waiting-on-admin', 'On me'], ['in-progress', 'In progress'], ['resolved', 'Resolved']].map(([v, l]) => (
                        <label key={v}><input type="radio" name="emComposeStatus" value={v} checked={statusRadio === v} onChange={() => setStatusRadio(v)} /> {l}</label>
                      ))}
                    </div>
                    <button type="button" className="btn-ghost attach-btn" onClick={() => fileRef.current?.click()}><Paperclip /> Attach</button>
                    <button className={`btn ${tab === 'internal' ? 'btn-internal' : 'btn-send'}`} onClick={submitComposer} disabled={busy}>{sendLabel}</button>
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            {user.role === 'admin' && (
              <button className="btn btn-ghost" style={{ marginRight: 'auto', color: ticket.deleted_at ? 'var(--blue)' : '#C0392B' }} onClick={toggleArchive} disabled={archiveBusy}>
                {archiveBusy ? (ticket.deleted_at ? 'Restoring…' : 'Archiving…') : (ticket.deleted_at ? 'Restore ticket' : 'Archive ticket')}
              </button>
            )}
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>

      {pill && <FloatingMenu rect={pill.rect} items={pillItems()} onClose={() => setPill(null)} />}
    </>
  );
}
