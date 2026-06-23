'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { sb, getAccessToken } from '@/lib/supabase';
import { CAT_LABEL, STATUS_LABEL, PRI_LABEL, IT_TEAM } from '@/lib/constants';
import { fmtDate, fmtShort } from '@/lib/format';
import { useIsMobile } from '@/lib/useIsMobile';
import { loadAttachmentMap, uploadImages } from '@/lib/attachments';
import { listGuidesForTicket, incrementUsage, type HelpGuide } from '@/lib/guides';
import { Conversation } from '@/components/Conversation';
import { GuideRail } from '@/components/admin/GuideRail';
import { GuideEditor } from '@/components/admin/GuideEditor';
import { FloatingMenu, MenuItem } from '@/components/admin/FloatingMenu';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { Thumb } from '@/components/Thumb';
import type { Ticket, Note, AttachMap } from '@/lib/types';

type AdminUser = { id: string; email: string; role: 'admin' | 'manager'; department: string | null; full_name: string };
type Tab = 'reply' | 'internal' | 'log';

const ST_CLS: Record<string, string> = { new: 'b-new', 'in-progress': 'b-progress', 'waiting-on-requester': 'b-waiting', 'waiting-on-admin': 'b-hold', 'on-hold': 'b-hold', resolved: 'b-resolved', closed: 'b-closed' };
const PR_CLS: Record<string, string> = { low: 'b-low', medium: 'b-medium', high: 'b-high', urgent: 'b-urgent' };
const Chev = () => <svg className="chev ico" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>;
const SendIco = () => <svg className="ico" width="13" height="13" viewBox="0 0 24 24"><polyline points="22 2 15 22 11 13 2 9 22 2" /></svg>;
const Paperclip = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -2 }}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>;
const Wand = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, verticalAlign: -2 }}><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></svg>;

export function EditModal({ ticket, user, onClose, onReload, patchTicket }: {
  ticket: Ticket; user: AdminUser; onClose: () => void;
  onReload: () => Promise<void>; patchTicket: (id: string, partial: Partial<Ticket>) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const isMobile = useIsMobile(900);
  const [attMap, setAttMap] = useState<AttachMap>({});
  const [tab, setTab] = useState<Tab>('reply');
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [statusRadio, setStatusRadio] = useState('');
  const [pane, setPane] = useState<'chat' | 'ticket' | 'guide'>('chat');
  const isAdmin = user.role === 'admin';
  const [guides, setGuides] = useState<HelpGuide[]>([]);
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);
  const [guideLoading, setGuideLoading] = useState(true);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [guideEditor, setGuideEditor] = useState<null | { guide?: HelpGuide | null; preset?: { category: string; sub_type: string | null } }>(null);
  const [flash, setFlash] = useState(false);
  const incrementedRef = useRef<Set<string>>(new Set());   // guides counted this open
  // Category-fit nudge (shown as a top-bar banner). Auto-checked on open; the
  // rail's "Suggest questions" call also feeds this via onMismatch.
  const [catMismatch, setCatMismatch] = useState<{ suggested: string; suggestedSubType?: string; level: 'weak' | 'mismatch' } | null>(null);
  const [catDismissed, setCatDismissed] = useState(false);
  const catCheckedRef = useRef<string | null>(null);
  const [pill, setPill] = useState<{ field: 'status' | 'priority' | 'assigned'; rect: DOMRect } | null>(null);
  const [busy, setBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [polishBusy, setPolishBusy] = useState(false);
  const [polishResult, setPolishResult] = useState<string | null>(null);
  const [polishNote, setPolishNote] = useState('');
  const convRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const notes: Note[] = (ticket.ticket_notes || []).slice().sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
  const reqFirst = (ticket.requester_name || '').split(' ')[0] || 'requester';

  // Pull the attachment map whenever the ticket or its note count changes.
  useEffect(() => {
    let on = true;
    loadAttachmentMap(ticket.id).then(m => { if (on) setAttMap(m); });
    return () => { on = false; };
  }, [ticket.id, notes.length]);

  // Load every guide relevant to this ticket (best match first) so the resolver
  // can pick when more than one fits. Default the selection to the best match.
  const loadGuides = useCallback(async () => {
    setGuideLoading(true);
    const list = await listGuidesForTicket(ticket.category, ticket.sub_type || null);
    setGuides(list);
    setSelectedGuideId(prev => (prev && list.some(g => g.id === prev)) ? prev : (list[0]?.id ?? null));
    setGuideLoading(false);
  }, [ticket.category, ticket.sub_type]);

  useEffect(() => { loadGuides(); }, [loadGuides]);

  const selectedGuide = guides.find(g => g.id === selectedGuideId) || null;

  // Count a surfacing once per guide per open (the default on open, plus any the
  // resolver switches to). Optimistically bump the visible counter.
  useEffect(() => {
    if (!selectedGuideId || incrementedRef.current.has(selectedGuideId)) return;
    incrementedRef.current.add(selectedGuideId);
    incrementUsage(selectedGuideId);
    setGuides(gs => gs.map(g => g.id === selectedGuideId ? { ...g, usage_count: g.usage_count + 1 } : g));
  }, [selectedGuideId]);

  // Lightweight category-fit check on open (once per ticket) → top-bar banner.
  // Silent, best-effort; never blocks the modal.
  useEffect(() => {
    if (catCheckedRef.current === ticket.id) return;
    catCheckedRef.current = ticket.id;
    let on = true;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch('/api/ticket-questions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ ticketId: ticket.id, mode: 'category' }),
        });
        const data = await res.json().catch(() => ({}));
        if (on && res.ok && data.ok && data.mismatch) { setCatMismatch(data.mismatch); setCatDismissed(false); }
      } catch { /* silent — category hint is best-effort */ }
    })();
    return () => { on = false; };
  }, [ticket.id]);

  // One-tap category switch from the rail's AI mismatch nudge. Optimistic + persisted.
  async function switchCategory(categoryKey: string, subType = '') {
    setCatMismatch(null);
    // Apply the AI-suggested request type when we have one; otherwise clear the
    // old sub-type (it belonged to the previous category and is now invalid).
    patchTicket(ticket.id, { category: categoryKey, sub_type: subType });
    try {
      const { error } = await sb.from('tickets').update({ category: categoryKey, sub_type: subType }).eq('id', ticket.id);
      if (error) throw error;
      toast(`Moved to ${CAT_LABEL[categoryKey] || categoryKey}${subType ? ' / ' + subType : ''}`);
      await onReload();
    } catch (err) {
      toast('Failed: ' + (err as Error).message);
      await onReload();
    }
  }

  // Tap-to-insert: append a clarifying question to the reply composer and flash it.
  const insertGuideText = (q: string) => {
    setTab('reply');
    setPane('chat');   // mobile: surface the composer where the text lands
    setText(prev => prev.trim() ? prev.replace(/\s*$/, '') + '\n' + q : q);
    setFlash(true);
    setTimeout(() => setFlash(false), 700);
  };

  // Auto-scroll to newest message on open and when a new note arrives.
  useEffect(() => {
    const c = convRef.current;
    if (!c) return;
    // Always land on the latest message — on open and after images load (which
    // change the height). rAF waits for layout so scrollHeight is final.
    requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; });
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
    // Images upload first (note_id null) and only get linked to a note once the
    // send/insert succeeds. If we never link them, delete them on failure — an
    // orphaned attachment would otherwise show up as a phantom "Submitted photo".
    let uploadedIds: string[] = [];
    let linked = false;
    try {
      uploadedIds = await uploadImages(ticket.id, files);
      if (tab === 'reply' || tab === 'log') {
        const { data: { session } } = await sb.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error('Session expired — please sign in again.');
        const res = await fetch('/api/send-message', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ ticketId: ticket.id, message: msg, direction: tab === 'reply' ? 'outbound' : 'inbound', newStatus, attachmentIds: uploadedIds }),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(result.error || ('HTTP ' + res.status));
        linked = true;   // send-message linked them server-side
        toast(tab === 'reply' ? 'Reply sent to requester.' : 'Reply logged against ticket.');
      } else {
        // Internal note — direct insert (no email).
        const { data: noteRow, error: noteErr } = await sb.from('ticket_notes').insert({
          ticket_id: ticket.id, added_by: user.full_name || user.email, note_text: msg, note_type: 'internal',
        }).select('id').single();
        if (noteErr) throw noteErr;
        if (uploadedIds.length) {
          await sb.from('ticket_attachments').update({ note_id: noteRow.id })
            .eq('ticket_id', ticket.id).is('note_id', null).in('id', uploadedIds);
        }
        linked = true;   // note created + attachments linked; a later status error must NOT delete them
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
      if (uploadedIds.length && !linked) {
        try { await sb.from('ticket_attachments').delete().in('id', uploadedIds); } catch { /* best-effort */ }
      }
      toast('Failed: ' + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Claude copy-edit of the reply draft — suggests only; admin accepts/dismisses.
  async function polish() {
    const t = text.trim();
    if (!t) return;
    setPolishBusy(true); setPolishNote(''); setPolishResult(null);
    try {
      const { data: { session } } = await sb.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Session expired');
      const res = await fetch('/api/polish-reply', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ text: t }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      const polished = (data.polished || '').trim();
      if (!polished || polished === t) setPolishNote('Looks good already.');
      else setPolishResult(polished);
    } catch {
      setPolishNote('Couldn’t polish — your text is unchanged.');
    } finally {
      setPolishBusy(false);
    }
  }

  // Polish is reply-only; clear any preview when the mode changes.
  useEffect(() => { setPolishResult(null); setPolishNote(''); }, [tab]);

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
    if (archiving && !(await confirm({
      title: `Archive ticket ${ticket.id}?`,
      body: 'It will be hidden from the list and the KPIs, but kept on record with its full conversation. You can restore it any time from "Show archived".',
      confirmLabel: 'Archive ticket', tone: 'danger',
    }))) return;
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
    : <>Emailed to <strong>{ticket.requester_email}</strong> with a secure link · they view &amp; respond in the portal</>;
  const sendLabel = busy ? (tab === 'internal' ? 'Saving…' : tab === 'log' ? 'Logging…' : 'Sending…')
    : tab === 'internal' ? 'Add Internal Note' : tab === 'log' ? 'Log Reply' : <>Send Reply <SendIco /></>;
  const placeholder = tab === 'internal' ? 'Add an internal note (IT team only)…' : tab === 'log' ? `Paste ${reqFirst}'s emailed reply…` : `Type your reply to ${reqFirst}…`;

  // Enter sends; Shift+Enter inserts a newline. Ignore while an IME is composing.
  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!busy) submitComposer();
    }
  };

  // Polish preview (before/after): the draft stays in the textarea; this shows the suggestion.
  const polishPanel = (
    <>
      {polishResult && (
        <div className="polish-panel">
          <div className="polish-panel-head"><Wand /> Polished suggestion</div>
          <div className="polish-panel-row">
            <div className="polish-panel-text">{polishResult}</div>
            <div className="polish-panel-actions">
              <button type="button" className="polish-act polish-dismiss" onClick={() => setPolishResult(null)} aria-label="Keep mine" title="Keep mine"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
              <button type="button" className="polish-act polish-accept" onClick={() => { setText(polishResult); setPolishResult(null); }} aria-label="Use this" title="Use this"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg></button>
            </div>
          </div>
        </div>
      )}
      {polishNote && <div className="polish-note">{polishNote}</div>}
    </>
  );

  // Category-fit banner in the modal top bar (one-tap, never auto-applied).
  const suggestedLabel = catMismatch
    ? (CAT_LABEL[catMismatch.suggested] || catMismatch.suggested) + (catMismatch.suggestedSubType ? ` / ${catMismatch.suggestedSubType}` : '')
    : '';
  const catBanner = catMismatch && !catDismissed ? (
    <div className={`cat-banner cat-banner-${catMismatch.level}`}>
      {catMismatch.level === 'mismatch'
        ? <svg className="cat-banner-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
        : <svg className="cat-banner-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>}
      <span className="cat-banner-msg">
        {catMismatch.level === 'mismatch'
          ? <>Filed under <strong>{CAT_LABEL[ticket.category] || ticket.category}</strong> but looks like <strong>{suggestedLabel}</strong>.</>
          : <>Filed under <strong>{CAT_LABEL[ticket.category] || ticket.category}</strong>. Might fit better under <strong>{suggestedLabel}</strong>.</>}
      </span>
      <button className="cat-banner-switch" onClick={() => switchCategory(catMismatch.suggested, catMismatch.suggestedSubType || '')}>Switch to {suggestedLabel}</button>
      <button className="cat-banner-keep" onClick={() => setCatDismissed(true)} aria-label="Dismiss">Keep</button>
    </div>
  ) : null;

  // ─────────────── Mobile layout (≤900px) — desktop is untouched ───────────────
  const MODE: Record<Tab, { label: string; ph: string; hint: string; btn: string; flip: string; accent: string; bg: string }> = {
    reply: { label: `Reply to ${reqFirst}`, ph: `Type your reply to ${reqFirst}…`, hint: `Emailed to ${ticket.requester_email} with a secure link — they respond in the portal.`, btn: 'Send reply', flip: '→ moves to Waiting on Requester', accent: '#FF6B43', bg: '#FFF1EC' },
    internal: { label: 'Internal note', ph: 'Add an internal note (only visible to IT)…', hint: 'Private — only visible to IT staff. The requester never sees this.', btn: 'Save note', flip: '', accent: '#B45309', bg: '#FEF6E7' },
    log: { label: 'Log their email reply', ph: `Paste ${reqFirst}'s email reply to log it on the ticket…`, hint: 'Records a reply they sent by email so the thread stays complete.', btn: 'Log reply', flip: '→ moves to Waiting on Admin', accent: '#475569', bg: '#EEF0F3' },
  };
  const cfg = MODE[tab];
  const busyLabel = tab === 'internal' ? 'Saving…' : tab === 'log' ? 'Logging…' : 'Sending…';
  const modeIco: Record<Tab, React.ReactNode> = {
    reply: <svg className="tdm-ico" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>,
    internal: <svg className="tdm-ico" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>,
    log: <svg className="tdm-ico" viewBox="0 0 24 24"><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>,
  };

  const mobileView = (
    <div className="tdm" onMouseDown={(e) => e.stopPropagation()}>
      {/* Compact header */}
      <div className="tdm-hdr">
        <div className="tdm-hdr-main">
          <div className="tdm-title">{ticket.subject}</div>
          <div className="tdm-meta">{ticket.id} · {CAT_LABEL[ticket.category] || ticket.category} · {fmtShort(ticket.created_at)}</div>
        </div>
        <button className="tdm-x" onClick={onClose} aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
      </div>

      {catBanner}

      {/* Tabs */}
      <div className="tdm-tabs">
        <button className={`tdm-tab${pane === 'chat' ? ' active' : ''}`} onClick={() => setPane('chat')}>Conversation</button>
        <button className={`tdm-tab${pane === 'ticket' ? ' active' : ''}`} onClick={() => setPane('ticket')}>Ticket details</button>
        <button className={`tdm-tab${pane === 'guide' ? ' active' : ''}`} onClick={() => setPane('guide')}>Guide</button>
      </div>

      {pane === 'guide' ? (
        <div className="tdm-guide">
          <GuideRail
            guides={guides} selectedId={selectedGuideId} onSelectGuide={setSelectedGuideId} loading={guideLoading} ticketId={ticket.id} category={ticket.category} notes={notes} isAdmin={isAdmin}
            variant="panel" onInsert={insertGuideText} onMismatch={(m) => { setCatMismatch(m); setCatDismissed(false); }}
            onEdit={() => setGuideEditor({ guide: selectedGuide })}
            onCreate={() => setGuideEditor({ preset: { category: ticket.category, sub_type: ticket.sub_type || null } })}
          />
        </div>
      ) : pane === 'chat' ? (
        <>
          {/* Thread — the only scrolling region */}
          <div className="tdm-thread" ref={convRef}>
            <Conversation notes={notes} reqFirst={reqFirst} attMap={attMap} bubbles />
          </div>

          {/* Pinned composer */}
          <div className="tdm-composer">
            <div className="tdm-mode-row">
              <button className="tdm-mode-pill" style={{ background: cfg.bg, color: cfg.accent }} onClick={() => setModeMenuOpen(o => !o)}>
                {modeIco[tab]}<span>{cfg.label}</span><svg className="tdm-chev" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              {cfg.flip && <span className="tdm-autoflip">{cfg.flip}</span>}
            </div>
            {modeMenuOpen && (
              <div className="tdm-mode-menu">
                {(['reply', 'internal', 'log'] as Tab[]).map(m => (
                  <button key={m} className={`tdm-mode-opt${tab === m ? ' sel' : ''}`} onClick={() => { setTab(m); setModeMenuOpen(false); }}>
                    {modeIco[m]}{MODE[m].label}
                  </button>
                ))}
              </div>
            )}
            <textarea className={flash ? 'composer-flash' : ''} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onComposerKey} placeholder={cfg.ph} />
            {polishPanel}
            {files.length > 0 && <div className="attach-preview">{files.map((f, i) => <span key={i} className="attach-chip"><span>{f.name}</span><button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove">×</button></span>)}</div>}
            <div className="tdm-send-row">
              <span className="tdm-send-hint">{cfg.hint}</span>
              <button type="button" className="tdm-polish" onClick={polish} disabled={polishBusy || !text.trim()} aria-label="Polish" title="Polish">{polishBusy ? '…' : <Wand />}</button>
              <button type="button" className="tdm-attach" onClick={() => fileRef.current?.click()} aria-label="Attach image"><Paperclip /></button>
              <button className="tdm-send" style={{ background: cfg.accent }} onClick={submitComposer} disabled={busy}>{busy ? busyLabel : cfg.btn}</button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>
        </>
      ) : (
        /* Ticket details tab */
        <div className="tdm-details">
          <div className="tdm-pills">
            <span className="pill-label">Status</span>
            <button className={`pill ${ST_CLS[ticket.status] || 'b-hold'}`} onClick={(e) => openPill('status', e)}>{STATUS_LABEL[ticket.status] || ticket.status}<Chev /></button>
            <span className="pill-label">Priority</span>
            <button className={`pill ${PR_CLS[ticket.priority] || 'b-low'}`} onClick={(e) => openPill('priority', e)}>{PRI_LABEL[ticket.priority] || ticket.priority}<Chev /></button>
            <span className="pill-label">Assigned</span>
            <button className={`pill ${ticket.assigned_to ? 'b-hold' : 'p-unassigned'}`} onClick={(e) => openPill('assigned', e)}>{ticket.assigned_to || 'Unassigned'}<Chev /></button>
          </div>
          <hr className="divider-line" />
          <div className="field"><div className="field-label">Description</div><div className="desc-block">{ticket.description}</div></div>
          {attMap['_unlinked']?.length ? (
            <div className="field"><div className="field-label">Submitted photo</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {attMap['_unlinked'].map((a, i) => <Thumb key={i} url={a.url} name={a.name} />)}
              </div>
            </div>
          ) : null}
          <hr className="divider-line" />
          <div className="field"><div className="field-label">Requester</div><div className="field-val">{ticket.requester_name}</div><div className="field-sub">{ticket.requester_email}</div></div>
          <div className="field"><div className="field-label">Department / Location</div><div className="field-val">{ticket.department}{ticket.location ? ' · ' + ticket.location : ''}</div></div>
          {ticket.affected_user && <div className="field"><div className="field-label">Affected user</div><div className="field-val">{ticket.affected_user}</div></div>}
          <div className="field"><div className="field-label">Submitted</div><div className="field-val">{fmtDate(ticket.created_at)}</div></div>
          {ticket.resolved_at && <div className="field"><div className="field-label">Resolved at</div><div className="field-val">{fmtDate(ticket.resolved_at)}</div></div>}
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="modal-overlay open" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {isMobile ? mobileView : (
        <div className="modal">
          <div className="modal-header">
            <div>
              <div className="modal-title">{ticket.subject}</div>
              <div className="modal-ticket-id">{ticket.id} · {(CAT_LABEL[ticket.category] || ticket.category)}{ticket.sub_type ? ` — ${ticket.sub_type}` : ''} · Submitted {fmtDate(ticket.created_at)}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <button className="btn-secondary" style={{ fontSize: 12 }} onClick={refresh} disabled={refreshBusy} title="Refresh this ticket">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>{refreshBusy ? 'Refreshing…' : 'Refresh'}
              </button>
              <button className="modal-close" onClick={onClose}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -2, flexShrink: 0 }}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
            </div>
          </div>

          {catBanner}

          <div className="modal-body">
            <div className="h-mobile-tabs" role="tablist">
              <button type="button" className={`hmt-btn${pane === 'chat' ? ' active' : ''}`} onClick={() => setPane('chat')}>Conversation</button>
              <button type="button" className={`hmt-btn${pane === 'ticket' ? ' active' : ''}`} onClick={() => setPane('ticket')}>Ticket details</button>
            </div>
            <div className={`h-body has-guide ${pane === 'chat' ? 'show-chat' : 'show-ticket'}${railCollapsed ? ' guide-collapsed' : ''}`}>

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
                      {attMap['_unlinked'].map((a, i) => <Thumb key={i} url={a.url} name={a.name} size={120} />)}
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
                  <Conversation notes={notes} reqFirst={reqFirst} attMap={attMap} bubbles />
                </div>

                <div className="composer">
                  <div className="compose-tabs">
                    <button className={`compose-tab tab-reply${tab === 'reply' ? ' active' : ''}`} onClick={() => setTab('reply')}><SendIco /> Reply to {reqFirst}</button>
                    <button className={`compose-tab tab-internal${tab === 'internal' ? ' active' : ''}`} onClick={() => setTab('internal')}><svg className="ico" width="13" height="13" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg> Internal note</button>
                    <button className={`compose-tab tab-log${tab === 'log' ? ' active' : ''}`} onClick={() => setTab('log')}><svg className="ico" width="13" height="13" viewBox="0 0 24 24"><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></svg> Log their email reply</button>
                  </div>
                  <div className="compose-meta">{composeMeta}</div>
                  <textarea className={flash ? 'composer-flash' : ''} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onComposerKey} placeholder={placeholder} />
                  {polishPanel}
                  {files.length > 0 && <div className="attach-preview">{files.map((f, i) => <span key={i} className="attach-chip"><span>{f.name}</span><button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove">×</button></span>)}</div>}
                  <div className="compose-actions">
                    <button type="button" className="btn-secondary" style={{ fontSize: 12, height: 32, padding: '0 14px' }} onClick={() => fileRef.current?.click()}><Paperclip /> Attach</button>
                    <div className="status-radio-row">
                      <span className="label-strong">Status:</span>
                      <select className="input" value={statusRadio} onChange={(e) => setStatusRadio(e.target.value)} style={{ width: 'auto', minWidth: 140, height: 32, padding: '0 10px', fontSize: 12 }}>
                        <option value="">No change</option>
                        <option value="waiting-on-requester">On requester</option>
                        <option value="waiting-on-admin">On me</option>
                        <option value="in-progress">In progress</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    </div>
                    <button type="button" className="btn-secondary" style={{ fontSize: 12, height: 32, padding: '0 14px' }} onClick={polish} disabled={polishBusy || !text.trim()}><Wand /> {polishBusy ? 'Polishing…' : 'Polish'}</button>
                    <button className={`btn ${tab === 'internal' ? 'btn-internal' : 'btn-send'}`} style={{ height: 32 }} onClick={submitComposer} disabled={busy}>{sendLabel}</button>
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                </div>
              </div>

              {/* GUIDE: help-guide rail (3rd column, collapsible) */}
              <GuideRail
                guides={guides} selectedId={selectedGuideId} onSelectGuide={setSelectedGuideId} loading={guideLoading} ticketId={ticket.id} category={ticket.category} notes={notes} isAdmin={isAdmin}
                variant="rail" collapsed={railCollapsed} onToggleCollapse={() => setRailCollapsed(c => !c)}
                onInsert={insertGuideText} onMismatch={(m) => { setCatMismatch(m); setCatDismissed(false); }}
                onEdit={() => setGuideEditor({ guide: selectedGuide })}
                onCreate={() => setGuideEditor({ preset: { category: ticket.category, sub_type: ticket.sub_type || null } })}
              />
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
        )}
      </div>

      {pill && <FloatingMenu rect={pill.rect} items={pillItems()} onClose={() => setPill(null)} />}

      {guideEditor && (
        <GuideEditor
          guide={guideEditor.guide}
          preset={guideEditor.preset}
          userName={user.full_name || user.email}
          onClose={() => setGuideEditor(null)}
          onSaved={async () => { setGuideEditor(null); await loadGuides(); }}
        />
      )}
    </>
  );
}
