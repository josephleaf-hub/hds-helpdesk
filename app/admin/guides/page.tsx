'use client';

import { useEffect, useState } from 'react';
import { sb } from '@/lib/supabase';
import { CAT_LABEL } from '@/lib/constants';
import { fmtRelative } from '@/lib/format';
import { listGuides, deleteGuide, type HelpGuide } from '@/lib/guides';
import { UserMenu } from '@/components/UserMenu';
import { GuideEditor } from '@/components/admin/GuideEditor';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';

type Editing = { guide?: HelpGuide | null; preset?: { category: string; sub_type: string | null } } | null;

export default function GuidesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [userLabel, setUserLabel] = useState('Loading…');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMgr, setIsMgr] = useState(false);
  const [userName, setUserName] = useState('');
  const [guides, setGuides] = useState<HelpGuide[]>([]);
  const [editing, setEditing] = useState<Editing>(null);

  async function reload() {
    setGuides(await listGuides());
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { window.location.href = '/login'; return; }
      const { data: role, error: roleErr } = await sb.from('user_roles').select('role, full_name').eq('user_id', session.user.id).single();
      if (roleErr || !role || (role.role !== 'admin' && role.role !== 'manager')) { await sb.auth.signOut(); window.location.href = '/login'; return; }
      if (!mounted) return;
      setUserLabel(`${role.full_name || session.user.email} · ${role.role === 'admin' ? 'IT Admin' : 'Manager'}`);
      setUserName(role.full_name || session.user.email || 'IT Staff');
      setIsAdmin(role.role === 'admin');
      setIsMgr(role.role === 'manager');
      try { await reload(); setPhase('ready'); }
      catch (e) { setErrMsg('Failed to load: ' + (e as Error).message); setPhase('error'); }
    })();
    return () => { mounted = false; };
  }, []);

  async function removeGuide(g: HelpGuide) {
    if (!(await confirm({ title: `Delete "${g.title}"?`, body: 'This removes the guide from the knowledge bank. This cannot be undone.', confirmLabel: 'Delete guide', tone: 'danger' }))) return;
    try { await deleteGuide(g.id); toast('Guide deleted.'); await reload(); }
    catch (e) { toast('Failed: ' + (e as Error).message); }
  }

  if (phase === 'loading' || phase === 'error') {
    return (
      <div className="loading-screen">
        {phase === 'loading' && <div className="spinner" />}
        <div className="loading-text">{phase === 'error' ? errMsg : 'Loading guides…'}</div>
      </div>
    );
  }

  // Group by category for display.
  const cats = Array.from(new Set(guides.map(g => g.category)));

  return (
    <main className="main analytics-main">
      <header className="topbar">
        <div className="topbar-left">
          <img src="https://cdn.prod.website-files.com/69d48f8f8f01871806e7f641/69e03c21c28ca297a9031891_Teritary-positive.png" alt="HDS" className="topbar-hds-logo" />
          <div className="logo-divider-line" />
          <div className="topbar-title">IT Admin Helpdesk</div>
        </div>
        <div className="topbar-right">
          <UserMenu label={userLabel} variant="admin" manager={isMgr} redirectTo="/login" />
        </div>
      </header>

      <div className="tab-bar-wrap">
        <div className="tab-bar">
          <a className="tab-btn" href="/admin"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, flexShrink: 0, marginRight: 7 }}><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path d="M13 5v2" /><path d="M13 11v2" /><path d="M13 17v2" /></svg> All Tickets</a>
          <span className="tab-btn active"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, flexShrink: 0, marginRight: 7 }}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg> Guides</span>
          {isAdmin && <a className="tab-btn" href="/admin/analytics"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, flexShrink: 0, marginRight: 7 }}><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg> Analytics</a>}
        </div>
        {isAdmin && <button className="btn-primary" style={{ fontSize: 12, flexShrink: 0 }} onClick={() => setEditing({})}>New guide</button>}
      </div>

      <div className="page-content">
        <div className="section-title" style={{ marginTop: 0 }}>Knowledge bank <span className="section-badge">{guides.length}</span></div>

        {!guides.length ? (
          <div className="guides-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#8A97A8' }}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
            <div className="guides-empty-title">No guides yet</div>
            <div className="guides-empty-sub">Build the team&apos;s knowledge bank — start with a common ticket type.</div>
            {isAdmin && <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => setEditing({})}>Create the first guide</button>}
          </div>
        ) : cats.map(cat => (
          <div key={cat} style={{ marginBottom: 22 }}>
            <div className="guides-cat-label">{CAT_LABEL[cat] || cat}</div>
            <div className="guides-grid">
              {guides.filter(g => g.category === cat).map(g => (
                <div key={g.id} className="guide-card">
                  <div className="guide-card-head">
                    <div className="guide-card-title">{g.title}</div>
                    <span className="guide-card-tag">{g.sub_type || 'Category-wide'}</span>
                  </div>
                  <div className="guide-card-stats">
                    <span>{g.questions.length} question{g.questions.length === 1 ? '' : 's'}</span>
                    <span>·</span>
                    <span>{g.steps.length} step{g.steps.length === 1 ? '' : 's'}</span>
                    <span>·</span>
                    <span>used on {g.usage_count}</span>
                  </div>
                  <div className="guide-card-foot">
                    <span className="guide-card-updated">Updated {fmtRelative(g.updated_at)}{g.updated_by ? ` · ${g.updated_by}` : ''}</span>
                    {isAdmin && (
                      <span className="guide-card-actions">
                        <button className="guide-card-link" onClick={() => setEditing({ guide: g })}>Edit</button>
                        <button className="guide-card-link guide-card-del" onClick={() => removeGuide(g)}>Delete</button>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <GuideEditor
          guide={editing.guide}
          preset={editing.preset}
          userName={userName}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload(); }}
        />
      )}
    </main>
  );
}
