'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { sb } from '@/lib/supabase';
import { CAT_LABEL, STATUS_ORDER, PRI_ORDER } from '@/lib/constants';
import { fmtDate, fmtShort } from '@/lib/format';
import { StatusBadge, PriBadge } from '@/components/Badges';
import { FloatingMenu } from '@/components/admin/FloatingMenu';
import { EditModal } from '@/components/admin/EditModal';
import { NewTicketModal } from '@/components/admin/NewTicketModal';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import type { Ticket } from '@/lib/types';

type AdminUser = { id: string; email: string; role: 'admin' | 'manager'; department: string | null; full_name: string };

// Sortable columns → comparable value. Strings lowercased; priority/status use logical order; dates by timestamp.
const SORT_KEYS: Record<string, (t: Ticket) => string | number> = {
  id: t => t.id,
  subject: t => (t.subject || '').toLowerCase(),
  category: t => (CAT_LABEL[t.category] || t.category || '').toLowerCase(),
  requester: t => (t.requester_name || '').toLowerCase(),
  department: t => (t.department || '').toLowerCase(),
  priority: t => (PRI_ORDER[t.priority] ?? 99),
  status: t => (STATUS_ORDER[t.status] ?? 99),
  submitted: t => +new Date(t.created_at),
  active: t => +new Date(t.updated_at || t.created_at),
};
const SORT_DEFAULT_DESC = new Set(['submitted', 'active']);
const COLS: { key?: string; label: string; width: string; photo?: boolean }[] = [
  { key: 'id', label: 'Ticket ID', width: '8%' }, { key: 'subject', label: 'Subject', width: 'auto' },
  { key: 'category', label: 'Category', width: '9%' }, { key: 'requester', label: 'Requester', width: '10%' },
  { key: 'department', label: 'Department', width: '8%' }, { key: 'priority', label: 'Priority', width: '8%' },
  { key: 'status', label: 'Status', width: '10%' }, { key: 'submitted', label: 'Submitted', width: '9%' },
  { key: 'active', label: 'Last Active', width: '13%' }, { label: '', width: '4%', photo: true }, { label: '', width: '4%' },
];

// Total attachments on a ticket, from the list query's ticket_attachments(count).
const photoCount = (t: Ticket) => t.ticket_attachments?.[0]?.count ?? 0;
const PhotoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, verticalAlign: -2 }}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
);

export default function AdminPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [phase, setPhase] = useState<'loading' | 'ready'>('loading');
  const [user, setUser] = useState<AdminUser | null>(null);
  const [allTickets, setAllTickets] = useState<Ticket[]>([]);
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fCat, setFCat] = useState('');
  const [fPri, setFPri] = useState('');
  const [fAssign, setFAssign] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ id: string; rect: DOMRect } | null>(null);

  const activeRef = useRef<string | null>(null); activeRef.current = activeId;
  const userRef = useRef<AdminUser | null>(null); userRef.current = user;
  const rowTimers = useRef<{ open?: ReturnType<typeof setTimeout>; close?: ReturnType<typeof setTimeout> }>({});

  // ── Auth bounce + initial load + auto-refresh ──
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { window.location.href = '/login'; return; }
      const { data: role, error } = await sb.from('user_roles').select('role, department, full_name').eq('user_id', session.user.id).single();
      if (error || !role) { await sb.auth.signOut(); window.location.href = '/login'; return; }
      if (!mounted) return;
      const u: AdminUser = { id: session.user.id, email: session.user.email!, role: role.role, department: role.department, full_name: role.full_name };
      setUser(u);
      await loadTickets(false, u);
      setPhase('ready');
    })();
    const iv = setInterval(() => { if (!document.hidden && userRef.current) loadTickets(true, userRef.current); }, 60 * 1000);
    return () => { mounted = false; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadTickets(silent: boolean, u: AdminUser | null = userRef.current) {
    if (!u) return;
    let q = sb.from('tickets').select('*, ticket_notes(id, added_by, note_text, note_type, created_at), ticket_attachments(count)').order('created_at', { ascending: false });
    if (u.role === 'manager' && u.department) q = q.eq('department', u.department);
    const { data, error } = await q;
    if (error) { if (!silent) toast('Failed to load tickets: ' + error.message); return; }
    setAllTickets((data as Ticket[]) || []);
  }

  function patchTicket(id: string, partial: Partial<Ticket>) {
    setAllTickets(list => list.map(t => t.id === id ? { ...t, ...partial } : t));
  }

  async function signOut() { await sb.auth.signOut(); window.location.href = '/login'; }

  function sortBy(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(SORT_DEFAULT_DESC.has(key) ? 'desc' : 'asc'); }
  }
  function clearFilters() { setSearch(''); setFStatus(''); setFCat(''); setFPri(''); setFAssign(''); setShowArchived(false); }

  // ── Filter + sort ──
  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return allTickets.filter(t => {
      if (t.deleted_at && !showArchived) return false;
      if (s && !`${t.id} ${t.subject} ${t.requester_name} ${t.department} ${t.sub_type}`.toLowerCase().includes(s)) return false;
      if (fStatus && t.status !== fStatus) return false;
      if (fCat && t.category !== fCat) return false;
      if (fPri && t.priority !== fPri) return false;
      if (fAssign === '__unassigned__' && t.assigned_to) return false;
      if (fAssign && fAssign !== '__unassigned__' && t.assigned_to !== fAssign) return false;
      return true;
    }).sort((a, b) => {
      if (sortKey && SORT_KEYS[sortKey]) {
        const va = SORT_KEYS[sortKey](a), vb = SORT_KEYS[sortKey](b);
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        if (cmp !== 0) return sortDir === 'desc' ? -cmp : cmp;
        return +new Date(b.created_at) - +new Date(a.created_at);
      }
      // Default order: most recently submitted first. The table no longer
      // reshuffles by status/priority — click a column header to re-sort.
      return +new Date(b.created_at) - +new Date(a.created_at);
    });
  }, [allTickets, search, fStatus, fCat, fPri, fAssign, showArchived, sortKey, sortDir]);

  // ── KPIs (archived never count) ──
  const kpi = useMemo(() => {
    const A = allTickets.filter(t => !t.deleted_at);
    return {
      newCount: A.filter(t => t.status === 'new').length,
      prog: A.filter(t => t.status === 'in-progress').length,
      hold: A.filter(t => t.status === 'on-hold').length,
      hiUrg: A.filter(t => ['urgent', 'high'].includes(t.priority) && ['new', 'in-progress'].includes(t.status)).length,
      done: A.filter(t => ['resolved', 'closed'].includes(t.status)).length,
    };
  }, [allTickets]);

  const isAdmin = user?.role === 'admin';
  const activeTicket = activeId ? allTickets.find(t => t.id === activeId) || null : null;

  // Row kebab (archive/restore) — hover to reveal with a small delay, click also works.
  function openRowMenu(id: string, el: HTMLElement) {
    clearTimeout(rowTimers.current.close);
    const rect = el.getBoundingClientRect();
    setRowMenu({ id, rect });
  }
  function hoverRow(id: string, el: HTMLElement) {
    clearTimeout(rowTimers.current.close);
    clearTimeout(rowTimers.current.open);
    rowTimers.current.open = setTimeout(() => openRowMenu(id, el), 120);
  }
  function leaveRow() {
    clearTimeout(rowTimers.current.open);
    clearTimeout(rowTimers.current.close);
    rowTimers.current.close = setTimeout(() => setRowMenu(null), 200);
  }

  async function archiveFromRow(id: string) {
    setRowMenu(null);
    const t = allTickets.find(x => x.id === id);
    if (!t) return;
    const archiving = !t.deleted_at;
    if (archiving && !(await confirm({
      title: `Archive ticket ${t.id}?`,
      body: 'It will be hidden from the list and the KPIs, but kept on record with its full conversation. You can restore it any time from "Show archived".',
      confirmLabel: 'Archive ticket', tone: 'danger',
    }))) return;
    try {
      const { error } = await sb.from('tickets').update({ deleted_at: archiving ? new Date().toISOString() : null }).eq('id', t.id);
      if (error) throw error;
      toast(archiving ? `Ticket ${t.id} archived.` : `Ticket ${t.id} restored.`);
      await loadTickets(true);
    } catch (err) { toast('Failed: ' + (err as Error).message); }
  }

  if (phase === 'loading') {
    return <div className="loading-screen"><div className="spinner" /><div className="loading-text">Checking authentication…</div></div>;
  }

  return (
    <>
      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-title">{isAdmin ? 'IT Admin Dashboard' : `${user?.department} — My Team's Tickets`}</div>
            <div className="topbar-meta">{isAdmin ? 'All tickets across the business' : `Manager view — ${user?.department} department`}</div>
          </div>
          <div className="topbar-right">
            <div className="admin-user-pill">
              <span className={`admin-role-dot${isAdmin ? '' : ' mgr'}`} />
              <span>{user?.full_name} · {isAdmin ? 'IT Admin' : 'Manager'}</span>
            </div>
            <button className="btn-ghost" onClick={signOut}>Sign Out</button>
            <div className="logo-divider-line" />
            <img src="https://cdn.prod.website-files.com/69d48f8f8f01871806e7f641/69e03c21c28ca297a9031891_Teritary-positive.png" alt="HDS" className="topbar-hds-logo" />
          </div>
        </header>

        <div className="tab-bar-wrap">
          <div className="tab-bar">
            <span className="tab-btn active">
              {isAdmin
                ? <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, flexShrink: 0, marginRight: 7 }}><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path d="M13 5v2" /><path d="M13 11v2" /><path d="M13 17v2" /></svg> All Tickets</>
                : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, flexShrink: 0, marginRight: 7 }}><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg> My Team&apos;s Tickets</>}
            </span>
            {isAdmin && <a className="tab-btn" href="/admin/analytics" style={{ textDecoration: 'none' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, flexShrink: 0, marginRight: 7 }}><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg> Analytics</a>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button className="btn-primary" style={{ fontSize: 12, padding: '8px 14px' }} onClick={() => setNewOpen(true)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg> New ticket</button>
            <button className="btn-secondary" style={{ fontSize: 12, flexShrink: 0 }} onClick={() => loadTickets(false)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>Refresh</button>
          </div>
        </div>

        <div className="page-content">
          <div className="kpi-wrap">
            <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
              <div className="kpi-card hds"><div className="kpi-lbl">New</div><div className="kpi-val">{kpi.newCount}</div><div className="kpi-sub">Awaiting action</div></div>
              <div className="kpi-card wrn"><div className="kpi-lbl">In Progress</div><div className="kpi-val">{kpi.prog}</div><div className="kpi-sub">Being worked on</div></div>
              <div className="kpi-card"><div className="kpi-lbl">On Hold</div><div className="kpi-val" style={{ color: '#4A5568' }}>{kpi.hold}</div><div className="kpi-sub">Awaiting info</div></div>
              <div className="kpi-card err"><div className="kpi-lbl">High / Urgent</div><div className="kpi-val">{kpi.hiUrg}</div><div className="kpi-sub">Active escalations</div></div>
              <div className="kpi-card grn"><div className="kpi-lbl">Resolved</div><div className="kpi-val">{kpi.done}</div><div className="kpi-sub">All time</div></div>
            </div>
          </div>

          <div className="filter-bar">
            <input className="input" type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets…" style={{ minWidth: 180 }} />
            <select className="input" value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={{ width: 130 }}>
              <option value="">All Statuses</option><option value="new">New</option><option value="in-progress">In Progress</option><option value="waiting-on-admin">Waiting on Admin</option><option value="waiting-on-requester">Waiting on Requester</option><option value="on-hold">On Hold</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
            </select>
            <select className="input" value={fCat} onChange={(e) => setFCat(e.target.value)} style={{ width: 150 }}>
              <option value="">All Categories</option><option value="access">Access Request</option><option value="hardware">Hardware</option><option value="account">Account Setup</option><option value="support">IT Support</option>
            </select>
            <select className="input" value={fPri} onChange={(e) => setFPri(e.target.value)} style={{ width: 115 }}>
              <option value="">All Priorities</option><option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
            <select className="input" value={fAssign} onChange={(e) => setFAssign(e.target.value)} style={{ width: 150 }}>
              <option value="">All Assignees</option><option value="__unassigned__">Unassigned</option><option value="IT Level 1">IT Level 1</option><option value="IT Level 2">IT Level 2</option><option value="Senior Engineer">Senior Engineer</option><option value="IT Manager">IT Manager</option>
            </select>
            <button className="btn-ghost" onClick={clearFilters} style={{ fontSize: 12 }}>Clear</button>
            {isAdmin && (
              <label className="arch-toggle">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                <span className="arch-track"><span className="arch-thumb" /></span>
                Show archived
              </label>
            )}
          </div>

          <div className="section-title" style={{ marginTop: 0 }}>Tickets <span className="section-badge">{filtered.length}</span></div>

          <div className="table-card">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    {COLS.map((c, i) => c.key ? (
                      <th key={i} className={`th-sort${sortKey === c.key ? ' sorted' : ''}`} style={{ width: c.width }} onClick={() => sortBy(c.key!)}>
                        {c.label} <span className={`sort-arrow${sortKey === c.key ? '' : ' dim'}`}>{sortKey === c.key ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                      </th>
                    ) : <th key={i} style={c.photo ? { width: '80px', whiteSpace: 'nowrap', textAlign: 'center', padding: '12px 8px', overflow: 'visible' } : { width: c.width }} title={c.photo ? 'Attached images' : undefined}>{c.photo ? 'Images' : null}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {!filtered.length ? (
                    <tr><td colSpan={11} style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>No tickets match your filters.</td></tr>
                  ) : filtered.map(t => {
                    const archived = !!t.deleted_at;
                    return (
                      <tr key={t.id} onClick={() => setActiveId(t.id)} style={archived ? { opacity: 0.55, cursor: 'pointer' } : { cursor: 'pointer' }}>
                        <td>{t.id}</td>
                        <td><div className="cell-subject"><span className="cell-ellipsis">{t.subject}</span>{archived && <span className="badge b-closed">Archived</span>}</div></td>
                        <td>{CAT_LABEL[t.category] || t.category}</td>
                        <td>{t.requester_name}</td>
                        <td>{t.department}</td>
                        <td><PriBadge priority={t.priority} /></td>
                        <td><StatusBadge status={t.status} /></td>
                        <td>{fmtShort(t.created_at)}</td>
                        <td>{fmtDate(t.updated_at || t.created_at)}</td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap', padding: '12px 8px', overflow: 'visible' }}>
                          {photoCount(t) > 0 && (
                            <span title={`${photoCount(t)} image${photoCount(t) > 1 ? 's' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#6B7280', fontSize: 12, fontWeight: 600 }}>
                              <PhotoIcon />{photoCount(t)}
                            </span>
                          )}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {isAdmin && (
                            <button className="kebab-btn" aria-label="Ticket actions" title="Actions"
                              onMouseEnter={(e) => hoverRow(t.id, e.currentTarget)} onMouseLeave={leaveRow}
                              onClick={(e) => openRowMenu(t.id, e.currentTarget)}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {rowMenu && (() => {
        const t = allTickets.find(x => x.id === rowMenu.id);
        if (!t) return null;
        return <FloatingMenu rect={rowMenu.rect} minWidth={150} align="right" onClose={() => setRowMenu(null)}
          onHoverKeepOpen={{ enter: () => clearTimeout(rowTimers.current.close), leave: leaveRow }}
          items={[t.deleted_at
            ? { label: 'Restore ticket', color: 'var(--blue)', onClick: () => archiveFromRow(t.id) }
            : { label: 'Archive ticket', color: '#C0392B', onClick: () => archiveFromRow(t.id) }]} />;
      })()}

      {activeTicket && user && <EditModal ticket={activeTicket} user={user} onClose={() => setActiveId(null)} onReload={() => loadTickets(true)} patchTicket={patchTicket} />}
      {newOpen && <NewTicketModal onClose={() => setNewOpen(false)} onReload={() => loadTickets(true)} />}
    </>
  );
}
