'use client';

import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { sb } from '@/lib/supabase';
import { CAT_LABEL, PORTAL_STATUS, STATUS_LABEL, SUB_TYPES, DEPARTMENTS, ALLOWED_DOMAINS } from '@/lib/constants';
import { fmtShort, fmtDate } from '@/lib/format';
import { loadAttachmentMap, compressImageToBase64, uploadImages } from '@/lib/attachments';
import { StatusBadge, PriBadge } from '@/components/Badges';
import { Conversation } from '@/components/Conversation';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { Thumb } from '@/components/Thumb';
import { UserMenu } from '@/components/UserMenu';
import { RealtimeAlertsProvider, MuteToggle } from '@/components/RealtimeAlerts';
import type { Ticket, Note, AttachMap } from '@/lib/types';

const LOCATIONS = ['Melbourne HQ', 'Sydney', 'Brisbane', 'Adelaide', 'Perth', 'Remote'];
const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
);

export default function Portal({ initialTicketId }: { initialTicketId?: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [signinExpired, setSigninExpired] = useState(false);
  const [view, setView] = useState<'list' | 'submit' | 'detail'>('list');

  // Refs so the 1-min interval reads live state without stale closures.
  const viewRef = useRef(view); viewRef.current = view;
  const authedRef = useRef(authed); authedRef.current = authed;
  const pendingOpen = useRef(initialTicketId || null);
  const prevAuthedRef = useRef<boolean | null>(null);

  // ── Mount: auth + staff redirect + magic-link handling + auto-refresh ──
  useEffect(() => {
    let mounted = true;
    // Email deep link lands on /?ticket=HDS-NNNN (see app/p/[...slug]); queue it to open.
    const qp = new URLSearchParams(window.location.search).get('ticket');
    if (qp) {
      pendingOpen.current = qp;
      const u = new URL(window.location.href);
      u.searchParams.delete('ticket');
      window.history.replaceState(null, '', u.pathname + u.search);
    }
    (async () => {
      const { data: { session } } = await sb.auth.getSession();
      if (session) {
        const { data: role } = await sb.from('user_roles').select('role').eq('user_id', session.user.id).maybeSingle();
        if (role && (role.role === 'admin' || role.role === 'manager')) { window.location.replace('/admin'); return; }
      }
      if (!mounted) return;
      syncAuth(session?.user ?? null);
      if (new URLSearchParams(window.location.search).get('signin') === 'expired' && !session) {
        setSignInOpen(true); setSigninExpired(true);
        window.history.replaceState(null, '', '/');
      }
    })();
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => syncAuth(s?.user ?? null));

    const iv = setInterval(() => {
      if (document.hidden || authedRef.current !== true) return;
      if (viewRef.current === 'detail') refreshOpenTicket();
      else if (viewRef.current === 'list') loadMyTickets(true);
    }, 60 * 1000);

    return () => { mounted = false; sub.subscription.unsubscribe(); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Supabase fires onAuthStateChange on every token refresh / tab focus / re-validate,
  // and the hash-based SIGNED_IN can land BEFORE the initial getSession() resolves.
  // Navigate ONLY on a real auth transition (was !== now) — covers first load, sign-in
  // and sign-out, but a redundant call while already authed (e.g. the slower getSession
  // arriving after SIGNED_IN already opened a deep-linked ticket) does nothing.
  function syncAuth(u: User | null) {
    const nowAuthed = !!u;
    const was = prevAuthedRef.current;        // null until the first call
    const transition = was !== nowAuthed;
    prevAuthedRef.current = nowAuthed;
    setUser(u);
    setAuthed(nowAuthed);
    if (nowAuthed) {
      loadMyTickets(!transition);             // silent background refresh when already signed in
      if (transition) {
        if (pendingOpen.current) { const id = pendingOpen.current; pendingOpen.current = null; openTicket(id); }
        else setView('list');
      }
    } else if (transition) {
      setView('submit');
    }
  }


  // ── My Tickets (RLS-scoped) ──
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [listError, setListError] = useState('');
  async function loadMyTickets(silent = false) {
    if (!silent) setTickets(null);
    const { data, error } = await sb.from('tickets').select('*').order('created_at', { ascending: false });
    if (error) { setListError(error.message); return; }
    setListError('');
    setTickets((data as Ticket[]) || []);
  }

  // ── Ticket detail ──
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const portalConvRef = useRef<HTMLDivElement>(null);
  // Keep the conversation scrolled to the latest message.
  useEffect(() => { const el = portalConvRef.current; if (el) el.scrollTop = el.scrollHeight; }, [notes]);
  const [attMap, setAttMap] = useState<AttachMap>({});
  const [detailError, setDetailError] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [replyBusy, setReplyBusy] = useState(false);
  const [resolveBusy, setResolveBusy] = useState(false);

  async function openTicket(id: string) {
    setView('detail'); setDetailError(''); setActiveTicket(null);
    setReplyText(''); setReplyFiles([]);
    window.history.replaceState(null, '', '/t/' + id);
    try {
      const { data: ticket, error } = await sb.from('tickets').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!ticket) { setDetailError("Ticket not found, or you don't have access to it."); return; }
      const { data: nrows, error: nErr } = await sb.from('ticket_notes').select('*').eq('ticket_id', id).order('created_at', { ascending: true });
      if (nErr) throw nErr;
      const map = await loadAttachmentMap(id);
      setActiveTicket(ticket as Ticket);
      setNotes((nrows as Note[]) || []);
      setAttMap(map);
    } catch (err) {
      setDetailError((err as Error).message);
    }
  }

  // Re-pull conversation in place (auto-refresh / after reply) — leaves the composer alone.
  async function refreshOpenTicket() {
    const t = activeTicket;
    if (!t) return;
    try {
      const { data: nrows } = await sb.from('ticket_notes').select('*').eq('ticket_id', t.id).order('created_at', { ascending: true });
      const map = await loadAttachmentMap(t.id);
      setNotes((nrows as Note[]) || []);
      setAttMap(map);
      const { data: fresh } = await sb.from('tickets').select('*').eq('id', t.id).maybeSingle();
      if (fresh) setActiveTicket(fresh as Ticket);
    } catch { /* transient */ }
  }

  async function callRequesterReply(payload: Record<string, unknown>) {
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('Session expired — please sign in again.');
    const res = await fetch('/api/requester-reply', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  async function sendPortalReply() {
    const text = replyText.trim();
    if (!text && !replyFiles.length) { toast('Type a reply or attach an image first.'); return; }
    if (!activeTicket) return;
    setReplyBusy(true);
    try {
      const attachmentIds = await uploadImages(activeTicket.id, replyFiles);
      await callRequesterReply({ ticketId: activeTicket.id, message: text || undefined, attachmentIds });
      setReplyText(''); setReplyFiles([]);
      toast('Reply sent.');
      await refreshOpenTicket();
    } catch (err) {
      toast('Failed: ' + (err as Error).message);
    } finally {
      setReplyBusy(false);
    }
  }

  async function markResolved() {
    if (!activeTicket) return;
    if (!(await confirm({ title: 'Mark this ticket as resolved?', body: 'This lets the IT team know your issue is sorted. You can always reply again if it isn’t.', confirmLabel: 'Mark resolved', tone: 'primary' }))) return;
    setResolveBusy(true);
    try {
      await callRequesterReply({ ticketId: activeTicket.id, message: replyText.trim() || undefined, resolve: true });
      toast('Ticket marked resolved.');
      await refreshOpenTicket();
    } catch (err) {
      toast('Failed: ' + (err as Error).message);
    } finally {
      setResolveBusy(false);
    }
  }

  function addReplyFiles(list: FileList | null) {
    if (!list) return;
    const next = [...replyFiles];
    for (const f of Array.from(list)) {
      if (next.length >= 3) { toast('You can attach up to 3 images.'); break; }
      if (!f.type.startsWith('image/')) { toast('Images only.'); continue; }
      if (f.size > 2 * 1024 * 1024) { toast(`"${f.name}" is over the 2 MB limit.`); continue; }
      next.push(f);
    }
    setReplyFiles(next);
  }

  // ── Submit form ──
  const [success, setSuccess] = useState<{ html: string } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dept, setDept] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [subType, setSubType] = useState('');
  const [priority, setPriority] = useState('medium');
  const [affected, setAffected] = useState('');
  const [subject, setSubject] = useState('');
  const [desc, setDesc] = useState('');
  const [submitFile, setSubmitFile] = useState<File | null>(null);
  const [emailErr, setEmailErr] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);

  function resetForm() {
    setSuccess(null); setName(''); setDept(''); setLocation(''); setCategory(''); setSubType('');
    setPriority('medium'); setAffected(''); setSubject(''); setDesc(''); setSubmitFile(null); setEmailErr('');
    if (!authed) setEmail('');
  }
  function goSubmit() { resetForm(); setView('submit'); }

  async function submitTicket() {
    const finalEmail = authed ? (user?.email || '') : email.trim().toLowerCase();
    setEmailErr('');
    if (!name.trim() || !finalEmail || !dept || !category || !subType || !subject.trim() || !desc.trim()) {
      toast('Please fill in all required fields.'); return;
    }
    if (!authed && (!finalEmail.includes('@') || !ALLOWED_DOMAINS.includes(finalEmail.split('@')[1]))) {
      setEmailErr('Please use your HDS work email (@homedelivery.com.au or @hdsau.com).'); return;
    }
    setSubmitBusy(true);
    try {
      let image = null;
      if (submitFile) image = await compressImageToBase64(submitFile);
      const res = await fetch('/api/submit-ticket', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, subType, priority, subject: subject.trim(), description: desc.trim(), requesterName: name.trim(), requesterEmail: finalEmail, department: dept, location, affectedUser: affected.trim(), image }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Submission failed');
      if (authed) {
        setSuccess({ html: `Ticket ${data.ticketId} submitted. The IT team has been notified and will respond shortly.` });
        loadMyTickets();
      } else {
        setSuccess({ html: data.confirmationSent === false
          ? `Submitted as <strong>${data.ticketId}</strong>. We couldn't send the sign-in email just now — use "Already have tickets? Sign in" to view your ticket. The IT team has been notified.`
          : `Submitted as <strong>${data.ticketId}</strong>. We've sent a confirmation to <strong>${finalEmail}</strong> with a link to view your ticket. The IT team has been notified and will be in touch shortly.` });
      }
    } catch (err) {
      toast((err as Error).message || 'Submission failed. Please try again.');
    } finally {
      setSubmitBusy(false);
    }
  }

  // ── Sign-in card ──
  const [authEmail, setAuthEmail] = useState('');
  const [authErr, setAuthErr] = useState('');
  const [authSent, setAuthSent] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  useEffect(() => { if (signinExpired) setAuthErr("That sign-in link is no longer valid — enter your email and we'll send a new one."); }, [signinExpired]);

  async function requestMagicLink() {
    const e = authEmail.trim().toLowerCase();
    setAuthErr('');
    if (!e || !e.includes('@')) { setAuthErr('Enter a valid email address.'); return; }
    if (!ALLOWED_DOMAINS.includes(e.split('@')[1])) { setAuthErr('Use your HDS work email (@homedelivery.com.au or @hdsau.com).'); return; }
    setAuthBusy(true);
    try {
      const res = await fetch('/api/regenerate-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setAuthSent(true);
    } catch (err) {
      setAuthErr((err as Error).message || 'Could not send the link. Try again.');
    } finally {
      setAuthBusy(false);
    }
  }

  // ─────────────────────────────── RENDER ───────────────────────────────
  if (authed === null) {
    return <div className="loading-screen"><div className="spinner" /><div className="loading-text">Loading…</div></div>;
  }

  if (signInOpen) {
    return (
      <div className="auth-wrap">
        {!authSent ? (
          <div className="auth-card">
            <img src="https://cdn.prod.website-files.com/69d48f8e8f01871806e7f5c4/69dc2749d52c90cf97e32309_Secondary-positive.png" alt="HDS" className="auth-logo" />
            <div className="auth-title">HDS IT Helpdesk</div>
            <div className="auth-sub">Enter your work email and we&apos;ll send you a secure sign-in link.</div>
            <input className="input" type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="name@homedelivery.com.au" autoComplete="email" onKeyDown={(e) => { if (e.key === 'Enter') requestMagicLink(); }} />
            {authErr && <div className="auth-err">{authErr}</div>}
            <button className="btn-primary btn-block" disabled={authBusy} onClick={requestMagicLink}>{authBusy ? 'Sending…' : 'Email me a sign-in link'}</button>
            <div style={{ marginTop: 14 }}><a href="#" style={{ color: 'var(--caption)', fontSize: 12, textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); setSignInOpen(false); }}>← Back to submitting a ticket</a></div>
            <div style={{ marginTop: 14, paddingTop: 16, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--caption)' }}>IT staff? <a href="/login" style={{ color: 'var(--blue)', fontWeight: 600, textDecoration: 'none' }}>Log in to the admin dashboard →</a></div>
          </div>
        ) : (
          <div className="auth-card">
            <div className="auth-check-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', margin: '0 auto' }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg></div>
            <div className="auth-title">Check your email</div>
            <div className="auth-sub">We&apos;ve emailed a sign-in link to <strong>{authEmail.trim().toLowerCase()}</strong>. It works on any device, any time.</div>
            <button className="btn-secondary" style={{ margin: '0 auto' }} onClick={() => { setAuthSent(false); setAuthErr(''); }}>← Use a different email</button>
          </div>
        )}
      </div>
    );
  }

  const reqFirst = (activeTicket?.requester_name || '').split(' ')[0] || 'there';

  return (
    <RealtimeAlertsProvider surface="requester" enabled={authed === true} onView={(id) => openTicket(id)} onActivity={() => { if (viewRef.current === 'detail') refreshOpenTicket(); else loadMyTickets(true); }}>
    <div className="portal-shell">
      <main className="main">
        <header className="portal-topbar">
          <div className="pt-left">
            <img src="https://cdn.prod.website-files.com/69d48f8f8f01871806e7f641/69e03c21c28ca297a9031891_Teritary-positive.png" alt="HDS" className="pt-logo" />
            <div className="pt-divider" />
            <div className="pt-title">{authed ? 'My IT tickets' : 'IT Helpdesk'}</div>
          </div>
          <div className="pt-right">
            {!authed && <a href="#" className="btn-secondary" style={{ fontSize: 12 }} onClick={(e) => { e.preventDefault(); setSignInOpen(true); setAuthSent(false); }}>Already have tickets? Sign in →</a>}
            {authed && <MuteToggle />}
            {authed && <UserMenu label={user?.email || ''} variant="portal" />}
          </div>
        </header>

        <div className="page-content">
          {view === 'list' && (
            <div>
              <div className="portal-hero">
                <div>
                  <div className="portal-hero-title">Your IT tickets</div>
                  <div className="portal-hero-sub">Submit a request, track its status, and reply — all in one place.</div>
                </div>
                <div className="portal-hero-actions">
                  <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => loadMyTickets()} title="Refresh tickets"><RefreshIcon />Refresh</button>
                  <button className="btn-primary" onClick={goSubmit}>+ Submit a new ticket</button>
                </div>
              </div>
              <div id="ticketList">
                {tickets === null ? <div className="spinner" />
                  : listError ? <div className="empty-state"><div className="empty-text" style={{ color: '#C0392B' }}>{listError}</div></div>
                  : !tickets.length ? (
                    <div className="empty-state">
                      <div className="empty-icon"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', margin: '0 auto', color: '#8A97A8' }}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg></div>
                      <div className="empty-text">You haven&apos;t submitted any tickets yet. Click &quot;Submit a new ticket&quot; to get started.</div>
                    </div>
                  ) : (
                    <div className="table-card"><div className="table-scroll">
                      <table>
                        <thead><tr><th>Ticket</th><th>Subject</th><th>Category</th><th>Priority</th><th>Status</th><th>Updated</th></tr></thead>
                        <tbody>
                          {tickets.map((t) => (
                            <tr key={t.id} onClick={() => openTicket(t.id)} className={t.status === 'waiting-on-requester' ? 'row-attention' : undefined} style={{ cursor: 'pointer' }}>
                              <td data-label="Ticket">{t.id}</td>
                              <td data-label="Subject">{t.subject}</td>
                              <td data-label="Category">{(CAT_LABEL[t.category] || t.category)} — {t.sub_type}</td>
                              <td data-label="Priority"><PriBadge priority={t.priority} /></td>
                              <td data-label="Status"><StatusBadge status={t.status} labels={PORTAL_STATUS} /></td>
                              <td data-label="Updated">{fmtShort(t.updated_at || t.created_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div></div>
                  )}
              </div>
            </div>
          )}

          {view === 'submit' && (
            <div id="submitView">
              {authed && <button className="btn-secondary" style={{ marginBottom: 8 }} onClick={() => setView('list')}>← Back to my tickets</button>}
              {success ? (
                <div className="success-panel show">
                  <div className="success-icon"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', margin: '0 auto', flexShrink: 0, color: '#2E7D52' }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg></div>
                  <div className="success-title">Ticket submitted!</div>
                  <div className="success-msg" dangerouslySetInnerHTML={{ __html: success.html }} />
                  {authed
                    ? <button className="btn-primary" style={{ margin: '0 auto' }} onClick={() => setView('list')}>Back to my tickets</button>
                    : <button className="btn-primary" style={{ margin: '0 auto' }} onClick={resetForm}>Submit another ticket</button>}
                </div>
              ) : (
                <SubmitForm
                  {...{ authed, name, setName, email: authed ? (user?.email || '') : email, setEmail, dept, setDept, location, setLocation,
                    category, setCategory, subType, setSubType, priority, setPriority, affected, setAffected, subject, setSubject,
                    desc, setDesc, submitFile, setSubmitFile, emailErr, submitBusy, submitTicket }}
                />
              )}
            </div>
          )}

          {view === 'detail' && (
            <div id="detailView">
              {!activeTicket ? (
                detailError
                  ? <><button className="btn-secondary" style={{ marginBottom: 8 }} onClick={() => setView('list')}>← Back to my tickets</button><div className="empty-state"><div className="empty-text" style={{ color: '#C0392B' }}>{detailError}</div></div></>
                  : <div className="spinner" />
              ) : (() => {
                const t = activeTicket;
                const isClosed = ['resolved', 'closed'].includes(t.status);
                return (
                  <>
                    <div className="detail-topbar">
                      <button className="btn-secondary detail-back" onClick={() => { setView('list'); window.history.replaceState(null, '', '/'); }}>← Back to my tickets</button>
                      <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => openTicket(t.id)} title="Refresh ticket"><RefreshIcon />Refresh</button>
                    </div>
                    <div className="detail-grid2">
                      <div className="detail-left"><div className="detail-card">
                        <div className="dh-title">{t.subject}</div>
                        <div className="dh-meta">{t.id} · {(CAT_LABEL[t.category] || t.category)} — {t.sub_type} · Submitted {fmtDate(t.created_at)}</div>
                        <hr className="divider-line" />
                        <div className="detail-statusrow">
                          <div className="field" style={{ marginBottom: 0 }}><div className="field-label">Status</div><div className="field-val"><StatusBadge status={t.status} labels={PORTAL_STATUS} /></div></div>
                          <div className="field" style={{ marginBottom: 0 }}><div className="field-label">Priority</div><div className="field-val"><PriBadge priority={t.priority} /></div></div>
                        </div>
                        <hr className="divider-line" />
                        <div className="field"><div className="field-label">Description</div><div className="desc-block">{t.description}</div></div>
                        {attMap['_unlinked']?.length ? (<><hr className="divider-line" /><div className="field"><div className="field-label">Attached photo</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>{attMap['_unlinked'].map((a, i) => <Thumb key={i} url={a.url} name={a.name} />)}</div></div></>) : null}
                        <hr className="divider-line" />
                        <div className="field"><div className="field-label">Department / Location</div><div className="field-val">{t.department}{t.location ? ' · ' + t.location : ''}</div></div>
                        <div className="field" style={{ marginBottom: 0 }}><div className="field-label">Assigned to</div><div className="field-val">{t.assigned_to || <span style={{ color: '#9CA3AF', fontStyle: 'italic' }}>Pending assignment</span>}</div></div>
                      </div></div>
                      <div className="detail-right">
                        <div className="detail-conv">
                          <div className="field-label" style={{ marginBottom: 10 }}>Conversation</div>
                          <div className="detail-conv-scroll" ref={portalConvRef}>
                            <Conversation notes={notes} reqFirst={reqFirst} attMap={attMap} maskStaff bubbles />
                          </div>
                        </div>
                        {isClosed ? (
                          <div className="resolved-notice">This ticket is {(STATUS_LABEL[t.status] || t.status).toLowerCase()}. If your issue isn&apos;t fixed, please submit a new ticket.</div>
                        ) : (
                          <div className="portal-composer">
                            <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Type your reply to the IT team…" />
                            {replyFiles.length > 0 && <div className="attach-preview">{replyFiles.map((f, i) => <span key={i} className="attach-chip"><span>{f.name}</span><button type="button" onClick={() => setReplyFiles(replyFiles.filter((_, j) => j !== i))} aria-label="Remove">×</button></span>)}</div>}
                            <div className="composer-actions">
                              <label className="btn-ghost attach-btn" style={{ cursor: 'pointer' }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -2 }}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg> Attach image
                                <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { addReplyFiles(e.target.files); e.target.value = ''; }} />
                              </label>
                              <span style={{ flex: 1 }} />
                              {t.status === 'waiting-on-requester' && <button className="btn-secondary" disabled={resolveBusy} onClick={markResolved}>{resolveBusy ? 'Resolving…' : 'Mark as resolved'}</button>}
                              <button className="btn-primary" disabled={replyBusy} onClick={sendPortalReply}>{replyBusy ? 'Sending…' : 'Send reply'}</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </main>
    </div>
    </RealtimeAlertsProvider>
  );
}

// ── Submit form (extracted for readability) ──
type SubmitProps = {
  authed: boolean; name: string; setName: (v: string) => void; email: string; setEmail: (v: string) => void;
  dept: string; setDept: (v: string) => void; location: string; setLocation: (v: string) => void;
  category: string; setCategory: (v: string) => void; subType: string; setSubType: (v: string) => void;
  priority: string; setPriority: (v: string) => void; affected: string; setAffected: (v: string) => void;
  subject: string; setSubject: (v: string) => void; desc: string; setDesc: (v: string) => void;
  submitFile: File | null; setSubmitFile: (f: File | null) => void; emailErr: string; submitBusy: boolean; submitTicket: () => void;
};

const CATS: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: 'access', label: 'Access Request', icon: <><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></> },
  { key: 'hardware', label: 'Hardware Request', icon: <><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></> },
  { key: 'account', label: 'Account Setup / Offboarding', icon: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></> },
  { key: 'support', label: 'General IT Support', icon: <><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></> },
];

function SubmitForm(p: SubmitProps) {
  return (
    <div>
      <div className="form-card">
        <div className="form-card-title"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, flexShrink: 0, marginRight: 8, color: '#1C64F2' }}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> Step 1 — Your details</div>
        <div className="form-grid">
          <div className="form-group"><label className="form-label">Full name <span className="req">*</span></label><input className="input" value={p.name} onChange={(e) => p.setName(e.target.value)} placeholder="e.g. Sarah Johnson" autoComplete="name" /></div>
          <div className="form-group">
            <label className="form-label">Work email {!p.authed && <span className="req">*</span>}</label>
            <input className="input" type="email" value={p.email} readOnly={p.authed} onChange={(e) => p.setEmail(e.target.value)} placeholder="name@homedelivery.com.au" autoComplete="email" style={p.authed ? { background: '#EEF0F3', color: '#6B7280', cursor: 'not-allowed' } : undefined} />
            {p.emailErr && <div className="form-error" style={{ display: 'block' }}>{p.emailErr}</div>}
            <div className="form-hint">{p.authed ? 'Signed in — replies go to this address.' : 'Use your HDS work email (@homedelivery.com.au or @hdsau.com).'}</div>
          </div>
          <div className="form-group"><label className="form-label">Department <span className="req">*</span></label>
            <select className="input" value={p.dept} onChange={(e) => p.setDept(e.target.value)}><option value="">Select department…</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select>
          </div>
          <div className="form-group"><label className="form-label">Location</label>
            <select className="input" value={p.location} onChange={(e) => p.setLocation(e.target.value)}><option value="">Select location…</option>{LOCATIONS.map((l) => <option key={l}>{l}</option>)}</select>
          </div>
        </div>
      </div>

      <div className="form-card">
        <div className="form-card-title"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, flexShrink: 0, marginRight: 8, color: '#1C64F2' }}><rect x="8" y="2" width="8" height="4" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></svg> Step 2 — What do you need? <span className="req">*</span></div>
        <div className="cat-grid">
          {CATS.map((c) => (
            <div key={c.key} className={`cat-card${p.category === c.key ? ' selected' : ''}`} onClick={() => { p.setCategory(c.key); p.setSubType(''); }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', margin: '0 auto', color: '#1C64F2' }}>{c.icon}</svg>
              <div className="cat-label">{c.label}</div>
            </div>
          ))}
        </div>
        {p.category && (
          <div className="form-grid" id="requestDetails">
            <div className="form-group"><label className="form-label">Request type <span className="req">*</span></label>
              <select className="input" value={p.subType} onChange={(e) => p.setSubType(e.target.value)}><option value="">Select type…</option>{(SUB_TYPES[p.category] || []).map((s) => <option key={s}>{s}</option>)}</select>
            </div>
            <div className="form-group"><label className="form-label">Priority <span className="req">*</span></label>
              <select className="input" value={p.priority} onChange={(e) => p.setPriority(e.target.value)}>
                <option value="low">Low — Not time-sensitive</option><option value="medium">Medium — Needed within a few days</option>
                <option value="high">High — Urgently impacting my work</option><option value="urgent">Urgent — I cannot work at all</option>
              </select>
            </div>
            <div className="form-group"><label className="form-label">Affected user</label><input className="input" value={p.affected} onChange={(e) => p.setAffected(e.target.value)} placeholder="Only if raising on behalf of someone else" /></div>
          </div>
        )}
      </div>

      {p.category && (
        <div className="form-card">
          <div className="form-card-title"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, flexShrink: 0, marginRight: 8, color: '#1C64F2' }}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg> Step 3 — Tell us more</div>
          <div className="form-group"><label className="form-label">Subject <span className="req">*</span></label><input className="input" value={p.subject} onChange={(e) => p.setSubject(e.target.value)} placeholder="One-line summary of your request" /></div>
          <div className="form-group"><label className="form-label">Description <span className="req">*</span></label><textarea className="input" value={p.desc} onChange={(e) => p.setDesc(e.target.value)} placeholder="Provide as much detail as possible — what you need, when, and any relevant context…" style={{ minHeight: 120 }} /></div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Attach a photo <span style={{ color: 'var(--caption)', fontWeight: 400 }}>(optional)</span></label>
            <label className="btn-ghost attach-btn" style={{ paddingLeft: 0, cursor: 'pointer' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, marginRight: 6, flexShrink: 0 }}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg> Add image
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f && f.type.startsWith('image/') && f.size <= 2 * 1024 * 1024) p.setSubmitFile(f); e.target.value = ''; }} />
            </label>
            {p.submitFile && <div className="attach-preview"><span className="attach-chip"><span>{p.submitFile.name}</span><button type="button" onClick={() => p.setSubmitFile(null)} aria-label="Remove">×</button></span></div>}
          </div>
        </div>
      )}

      {p.category && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 32 }}>
          <button className="btn-primary" disabled={p.submitBusy} onClick={p.submitTicket} style={{ padding: '11px 28px', fontSize: 14 }}>{p.submitBusy ? 'Submitting…' : 'Submit ticket →'}</button>
        </div>
      )}
    </div>
  );
}
