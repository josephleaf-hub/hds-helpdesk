'use client';

import { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { sb } from '@/lib/supabase';
import { CAT_LABEL, STATUS_LABEL, PRI_LABEL } from '@/lib/constants';
import { fmtDur, median } from '@/lib/format';
import { UserMenu } from '@/components/UserMenu';

type ARow = {
  id: string; category: string; sub_type: string; priority: string;
  status: string; department: string | null; created_at: string; resolved_at: string | null;
};
type FirstOut = Record<string, string>;

const chartFont = { family: 'Inter', size: 11 };
const baseScales = {
  x: { grid: { color: '#E2E8EF' }, ticks: { color: '#8A97A8', font: chartFont }, border: { display: false }, beginAtZero: true },
  y: { grid: { color: '#E2E8EF' }, ticks: { color: '#8A97A8', font: chartFont, precision: 0 }, border: { display: false }, beginAtZero: true },
} as const;
const tooltip = { backgroundColor: '#0F1C2E', titleFont: { ...chartFont, weight: 600 as const, size: 12 }, bodyFont: chartFont, padding: 10, cornerRadius: 6 };

const ACTIVE = ['new', 'in-progress', 'waiting-on-admin', 'waiting-on-requester', 'on-hold'];
const ms = (s: string) => new Date(s).getTime();

export default function AnalyticsPage() {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [userLabel, setUserLabel] = useState('Loading…');
  const [isMgr, setIsMgr] = useState(false);
  const [tickets, setTickets] = useState<ARow[]>([]);
  const [firstOut, setFirstOut] = useState<FirstOut>({});

  // ── Auth bounce (exactly like /admin) + data load ──
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { window.location.href = '/login'; return; }
      const { data: role, error: roleErr } = await sb
        .from('user_roles').select('role, department, full_name').eq('user_id', session.user.id).single();
      if (roleErr || !role || (role.role !== 'admin' && role.role !== 'manager')) {
        await sb.auth.signOut(); window.location.href = '/login'; return;
      }
      if (!mounted) return;
      setUserLabel(`${role.full_name || session.user.email} · ${role.role === 'admin' ? 'IT Admin' : 'Manager'}`);
      setIsMgr(role.role === 'manager');

      // RLS scopes this: admins see all, managers see their department only.
      const { data: trows, error: tErr } = await sb
        .from('tickets')
        .select('id, category, sub_type, priority, status, department, created_at, resolved_at')
        .is('deleted_at', null);
      if (tErr) { setErrMsg('Failed to load: ' + tErr.message); setPhase('error'); return; }

      const { data: outNotes } = await sb
        .from('ticket_notes').select('ticket_id, created_at')
        .eq('note_type', 'outbound').order('created_at', { ascending: true });
      const fo: FirstOut = {};
      for (const n of (outNotes || [])) if (!fo[n.ticket_id]) fo[n.ticket_id] = n.created_at;

      if (!mounted) return;
      setTickets((trows as ARow[]) || []);
      setFirstOut(fo);
      setPhase('ready');
    })();
    return () => { mounted = false; };
  }, []);

  if (phase === 'loading' || phase === 'error') {
    return (
      <div className="loading-screen">
        {phase === 'loading' && <div className="spinner" />}
        <div className="loading-text">{phase === 'error' ? errMsg : 'Loading analytics…'}</div>
      </div>
    );
  }

  // ── Derived KPI scalars ──
  const total = tickets.length;
  const now = Date.now();
  const active = tickets.filter(t => ACTIVE.includes(t.status));
  const awaitIT = tickets.filter(t => ['new', 'in-progress', 'waiting-on-admin'].includes(t.status)).length;
  const awaitReq = tickets.filter(t => t.status === 'waiting-on-requester').length;
  const onHold = tickets.filter(t => t.status === 'on-hold').length;
  const resolved = tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length;

  let oldest: { c: number; id: string } | null = null;
  for (const t of active) { const c = ms(t.created_at); if (!oldest || c < oldest.c) oldest = { c, id: t.id }; }

  const frTimes: number[] = [], resTimes: number[] = [];
  let fastest: { r: number; id: string } | null = null;
  for (const t of tickets) {
    const c = ms(t.created_at);
    if (firstOut[t.id]) frTimes.push(ms(firstOut[t.id]) - c);
    if (t.resolved_at) { const r = ms(t.resolved_at) - c; resTimes.push(r); if (!fastest || r < fastest.r) fastest = { r, id: t.id }; }
  }
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const resolvedWeek = tickets.filter(t => t.resolved_at && ms(t.resolved_at) >= weekAgo).length;
  const openedWeek = tickets.filter(t => ms(t.created_at) >= weekAgo).length;

  // ── Category table rows ──
  const catOrder = ['access', 'hardware', 'account', 'support'];
  const catPresent = catOrder.filter(c => tickets.some(t => t.category === c));
  tickets.forEach(t => { if (!catOrder.includes(t.category) && !catPresent.includes(t.category)) catPresent.push(t.category); });
  const allFr: number[] = [], allRes: number[] = [];
  const catRows = catPresent.map(c => {
    const ts = tickets.filter(t => t.category === c);
    const fr: number[] = [], res: number[] = [];
    ts.forEach(t => { const cr = ms(t.created_at); if (firstOut[t.id]) fr.push(ms(firstOut[t.id]) - cr); if (t.resolved_at) res.push(ms(t.resolved_at) - cr); });
    allFr.push(...fr); allRes.push(...res);
    return { c, n: ts.length, share: Math.round(ts.length / total * 100), fr: fr.length ? fmtDur(median(fr)!) : '—', res: res.length ? fmtDur(median(res)!) : '—' };
  });

  const hasCategory = catPresent.length > 0;
  const hasVolume = total > 0;
  const deptCounts: Record<string, number> = {};
  tickets.forEach(t => { const d = t.department || 'Unspecified'; deptCounts[d] = (deptCounts[d] || 0) + 1; });
  const hasDept = Object.keys(deptCounts).length > 0;

  return (
    <main className="main">
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">IT Helpdesk — Analytics</div>
          <div className="topbar-meta">{`All ${total} ticket${total === 1 ? '' : 's'} since launch · updated just now`}</div>
        </div>
        <div className="topbar-right">
          <UserMenu label={userLabel} variant="admin" manager={isMgr} redirectTo="/login" />
          <div className="logo-divider-line" />
          <img src="https://cdn.prod.website-files.com/69d48f8f8f01871806e7f641/69e03c21c28ca297a9031891_Teritary-positive.png" alt="HDS" className="topbar-hds-logo" />
        </div>
      </header>

      <div className="tab-bar-wrap">
        <div className="tab-bar">
          <a className="tab-btn" href="/admin"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, flexShrink: 0, marginRight: 7 }}><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path d="M13 5v2" /><path d="M13 11v2" /><path d="M13 17v2" /></svg> All Tickets</a>
          <span className="tab-btn active"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, flexShrink: 0, marginRight: 7 }}><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg> Analytics</span>
        </div>
        <button className="btn-secondary" style={{ fontSize: 12, flexShrink: 0 }} onClick={() => window.location.reload()}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>Refresh</button>
      </div>

      <div className="page-content">
        {/* SNAPSHOT */}
        <div className="section-title">Snapshot <span className="section-title-badge">Live</span></div>
        <div className="kpi-wrap"><div className="kpi-grid">
          <Kpi cls="hds" label="Open backlog" value={active.length} sub="Active tickets" />
          <Kpi cls="wrn" label="Awaiting IT" value={awaitIT} sub="Your move" />
          <Kpi label="Awaiting requester" value={awaitReq} sub="Ball in their court" />
          <Kpi label="On hold" value={onHold} sub="Paused" />
          <Kpi cls="grn" label="Resolved" value={resolved} sub={total ? `${Math.round(resolved / total * 100)}% of all tickets` : 'No tickets yet'} />
          <Kpi label="Oldest open" value={oldest ? fmtDur(now - oldest.c) : '—'} sub={oldest ? oldest.id : 'No open tickets'} />
        </div></div>

        {/* PERFORMANCE */}
        <div className="section-title">Response &amp; resolution</div>
        <div className="kpi-wrap"><div className="kpi-grid">
          <Kpi label="Median first response" value={frTimes.length ? fmtDur(median(frTimes)!) : '—'} sub="Ticket open → first IT reply" />
          <Kpi label="Median time to resolve" value={resTimes.length ? fmtDur(median(resTimes)!) : '—'} sub="Open → resolved" />
          <Kpi label="Fastest resolve" value={fastest ? fmtDur(fastest.r) : '—'} sub={fastest ? fastest.id : 'None resolved yet'} />
          <Kpi label="Resolved this week" value={resolvedWeek} sub={`of ${openedWeek} opened`} />
        </div></div>

        {/* BREAKDOWN */}
        <div className="section-title">Breakdown</div>
        <div className="chart-2col">
          <ChartCard title="Tickets by category" subtitle="What people are raising" hasData={hasCategory}>
            {(ref) => <Charts.Category refEl={ref} tickets={tickets} />}
          </ChartCard>
          <ChartCard title="Current pipeline" subtitle="Tickets by status" hasData>
            {(ref) => <Charts.Status refEl={ref} tickets={tickets} />}
          </ChartCard>
        </div>

        {/* PRIORITY */}
        <div className="section-title">By priority</div>
        <ChartCard title="Tickets by priority" subtitle="How urgent the load is" hasData wide>
          {(ref) => <Charts.Priority refEl={ref} tickets={tickets} />}
        </ChartCard>

        {/* VOLUME */}
        <div className="section-title">Over time</div>
        <div className="note-banner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
          Trend lines get more meaningful as volume builds — at low ticket counts this is indicative, not statistical.
        </div>
        <ChartCard title="Tickets over time" subtitle="Opened vs resolved, last 14 days" hasData={hasVolume} wide>
          {(ref) => <Charts.Volume refEl={ref} tickets={tickets} />}
        </ChartCard>

        {/* CATEGORY TABLE */}
        <div className="section-title">By category</div>
        <div className="table-card"><div className="table-scroll">
          <table>
            <thead><tr>
              <th>Category</th><th className="text-center">Tickets</th><th className="text-center">Share</th>
              <th className="text-center">Median first response</th><th className="text-center">Median resolve</th>
            </tr></thead>
            <tbody>
              {!total ? <tr><td colSpan={5} className="text-center" style={{ padding: 24, color: '#6B7280' }}>No tickets yet.</td></tr> : (<>
                {catRows.map(r => (
                  <tr key={r.c}><td>{CAT_LABEL[r.c] || r.c}</td><td className="text-center">{r.n}</td><td className="text-center">{r.share}%</td><td className="text-center">{r.fr}</td><td className="text-center">{r.res}</td></tr>
                ))}
                <tr className="tr-total"><td>Total</td><td className="text-center">{total}</td><td className="text-center">100%</td><td className="text-center">{allFr.length ? fmtDur(median(allFr)!) : '—'}</td><td className="text-center">{allRes.length ? fmtDur(median(allRes)!) : '—'}</td></tr>
              </>)}
            </tbody>
          </table>
        </div></div>

        {/* DEPARTMENT */}
        <div className="section-title">By department</div>
        <ChartCard title="Tickets by department" subtitle="Which teams are generating load" hasData={hasDept} wide>
          {(ref) => <Charts.Dept refEl={ref} deptCounts={deptCounts} />}
        </ChartCard>
      </div>
    </main>
  );
}

// ── KPI card (shared class names: kpi-card + hds/grn/wrn, kpi-lbl/kpi-val/kpi-sub) ──
function Kpi({ cls, label, value, sub }: { cls?: string; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className={`kpi-card${cls ? ' ' + cls : ''}`}>
      <div className="kpi-lbl">{label}</div>
      <div className="kpi-val">{value}</div>
      {sub != null && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

// ── Chart card wrapper: renders the canvas (via render-prop) or a no-data placeholder ──
function ChartCard({ title, subtitle, hasData, wide, children }: {
  title: string; subtitle: string; hasData: boolean; wide?: boolean;
  children: (ref: React.RefObject<HTMLCanvasElement>) => React.ReactNode;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  return (
    <div className="chart-wrap" style={wide ? { marginBottom: 20 } : undefined}>
      <div className="chart-header"><div>
        <div className="chart-title">{title}</div>
        <div className="chart-subtitle">{subtitle}</div>
      </div></div>
      <div className="chart-canvas-wrap">
        {hasData ? <><canvas ref={ref} />{children(ref)}</> : <div className="chart-nodata">Not enough data yet</div>}
      </div>
    </div>
  );
}

// ── Chart builders: each mounts a Chart.js instance on the shared canvas ref ──
function useChart(ref: React.RefObject<HTMLCanvasElement>, build: () => Chart, deps: unknown[]) {
  useEffect(() => {
    if (!ref.current) return;
    const chart = build();
    return () => chart.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return null;
}

const PALETTE = ['#1C64F2', '#2E7D52', '#B45309', '#6D28D9', '#93AEED', '#8A97A8', '#0D1B2E'];

const Charts = {
  Category({ refEl, tickets }: { refEl: React.RefObject<HTMLCanvasElement>; tickets: ARow[] }) {
    return useChart(refEl, () => {
      const order = ['access', 'hardware', 'account', 'support'];
      const counts: Record<string, number> = {}; tickets.forEach(t => counts[t.category] = (counts[t.category] || 0) + 1);
      const present = order.filter(c => counts[c] > 0);
      Object.keys(counts).forEach(c => { if (!order.includes(c) && counts[c] > 0) present.push(c); });
      return new Chart(refEl.current!, {
        type: 'doughnut',
        data: { labels: present.map(c => CAT_LABEL[c] || c), datasets: [{ data: present.map(c => counts[c]), backgroundColor: present.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 3, borderColor: '#FFFFFF' }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { font: chartFont, color: '#4A5568', boxWidth: 10, padding: 14 } }, tooltip } },
      });
    }, [tickets]);
  },
  Status({ refEl, tickets }: { refEl: React.RefObject<HTMLCanvasElement>; tickets: ARow[] }) {
    return useChart(refEl, () => {
      const order = ['new', 'in-progress', 'waiting-on-admin', 'waiting-on-requester', 'on-hold', 'resolved', 'closed'];
      const colors: Record<string, string> = { 'new': '#1C64F2', 'in-progress': '#93AEED', 'waiting-on-admin': '#6D28D9', 'waiting-on-requester': '#B45309', 'on-hold': '#8A97A8', 'resolved': '#2E7D52', 'closed': '#0D1B2E' };
      const counts: Record<string, number> = {}; order.forEach(s => counts[s] = 0);
      tickets.forEach(t => { if (counts[t.status] != null) counts[t.status]++; });
      return new Chart(refEl.current!, {
        type: 'bar',
        data: { labels: order.map(s => STATUS_LABEL[s] || s), datasets: [{ data: order.map(s => counts[s]), backgroundColor: order.map(s => colors[s]), borderRadius: 3, borderWidth: 1, borderColor: '#F4F6F8', borderSkipped: false }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip }, scales: baseScales },
      });
    }, [tickets]);
  },
  Priority({ refEl, tickets }: { refEl: React.RefObject<HTMLCanvasElement>; tickets: ARow[] }) {
    return useChart(refEl, () => {
      const order = ['urgent', 'high', 'medium', 'low'];
      const colors: Record<string, string> = { urgent: '#C0392B', high: '#B45309', medium: '#1C64F2', low: '#8A97A8' };
      const counts: Record<string, number> = {}; order.forEach(p => counts[p] = 0);
      tickets.forEach(t => { if (counts[t.priority] != null) counts[t.priority]++; });
      return new Chart(refEl.current!, {
        type: 'bar',
        data: { labels: order.map(p => PRI_LABEL[p] || p), datasets: [{ data: order.map(p => counts[p]), backgroundColor: order.map(p => colors[p]), borderRadius: 3, borderWidth: 1, borderColor: '#F4F6F8', borderSkipped: false }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip }, scales: baseScales },
      });
    }, [tickets]);
  },
  Volume({ refEl, tickets }: { refEl: React.RefObject<HTMLCanvasElement>; tickets: ARow[] }) {
    return useChart(refEl, () => {
      const DAY = 24 * 60 * 60 * 1000;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const start = today.getTime() - 13 * DAY;
      const labels: string[] = [], opened = new Array(14).fill(0), resolvedArr = new Array(14).fill(0);
      let lastMonth: string | null = null;
      for (let i = 0; i < 14; i++) {
        const d = new Date(start + i * DAY);
        const mon = d.toLocaleDateString('en-AU', { month: 'short' });
        labels.push(mon !== lastMonth ? d.getDate() + ' ' + mon : '' + d.getDate());
        lastMonth = mon;
      }
      const idxFor = (t: string) => { const d = new Date(t); d.setHours(0, 0, 0, 0); const i = Math.round((d.getTime() - start) / DAY); return (i >= 0 && i < 14) ? i : -1; };
      tickets.forEach(t => {
        const oi = idxFor(t.created_at); if (oi >= 0) opened[oi]++;
        if (t.resolved_at) { const ri = idxFor(t.resolved_at); if (ri >= 0) resolvedArr[ri]++; }
      });
      return new Chart(refEl.current!, {
        type: 'line',
        data: { labels, datasets: [
          { label: 'Opened', data: opened, borderColor: '#1C64F2', backgroundColor: 'rgba(28,100,242,0.08)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#1C64F2' },
          { label: 'Resolved', data: resolvedArr, borderColor: '#2E7D52', backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#2E7D52' },
        ] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: chartFont, color: '#4A5568', boxWidth: 10, padding: 14 } }, tooltip }, scales: baseScales },
      });
    }, [tickets]);
  },
  Dept({ refEl, deptCounts }: { refEl: React.RefObject<HTMLCanvasElement>; deptCounts: Record<string, number> }) {
    return useChart(refEl, () => {
      const entries = Object.entries(deptCounts).sort((a, b) => b[1] - a[1]);
      return new Chart(refEl.current!, {
        type: 'bar',
        data: { labels: entries.map(e => e[0]), datasets: [{ label: 'Tickets', data: entries.map(e => e[1]), backgroundColor: '#1C64F2', borderRadius: 3, borderWidth: 1, borderColor: '#F4F6F8', borderSkipped: false }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip }, scales: baseScales },
      });
    }, [deptCounts]);
  },
};
