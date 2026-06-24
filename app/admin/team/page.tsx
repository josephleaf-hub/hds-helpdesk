'use client';

/* Team & access — list the team and (Owners only) invite, change roles, and
   deactivate. Admins see the list read-only. All mutations are re-checked on the
   server; the UI only hides controls. */

import { useEffect, useState } from 'react';
import { sb, getAccessToken } from '@/lib/supabase';
import { DEPARTMENTS } from '@/lib/constants';
import { fmtRelative } from '@/lib/format';
import { UserMenu } from '@/components/UserMenu';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';

type TeamUser = { user_id: string; full_name: string; email: string; role: string; department: string | null; is_owner: boolean; status: string; last_active: string | null };

const ROLE_BADGE: Record<string, string> = { owner: 'tm-owner', admin: 'tm-admin', manager: 'tm-manager' };
const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', manager: 'Manager' };

async function teamFetch(path: string, body: object) {
  const token = await getAccessToken();
  const res = await fetch(`/api/team/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

export default function TeamPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [userLabel, setUserLabel] = useState('Loading…');
  const [isMgr, setIsMgr] = useState(false);
  const [viewerId, setViewerId] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [busyId, setBusyId] = useState('');

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [iName, setIName] = useState(''); const [iEmail, setIEmail] = useState('');
  const [iRole, setIRole] = useState('admin'); const [iDept, setIDept] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);

  // Role modal
  const [roleFor, setRoleFor] = useState<TeamUser | null>(null);
  const [roleVal, setRoleVal] = useState('admin'); const [roleBusy, setRoleBusy] = useState(false);

  async function load() {
    const data = await teamFetch('list', {});
    setUsers(data.users); setViewerId(data.viewerId); setIsOwner(data.viewerIsOwner);
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { window.location.href = '/login'; return; }
      const { data: role } = await sb.from('user_roles').select('role, full_name, is_owner').eq('user_id', session.user.id).single();
      if (!role || role.role !== 'admin') { window.location.href = '/admin'; return; }   // managers/non-admins out
      if (!mounted) return;
      setUserLabel(`${role.full_name || session.user.email} · ${role.is_owner ? 'Owner' : 'IT Admin'}`);
      setIsMgr(false);
      try { await load(); setPhase('ready'); }
      catch (e) { setErrMsg('Failed to load: ' + (e as Error).message); setPhase('error'); }
    })();
    return () => { mounted = false; };
  }, []);

  async function doInvite() {
    if (!iName.trim()) { toast('Enter a full name.'); return; }
    if (!iEmail.trim()) { toast('Enter an email.'); return; }
    setInviteBusy(true);
    try {
      const data = await teamFetch('invite', { full_name: iName.trim(), email: iEmail.trim(), role: iRole, department: iDept || undefined });
      toast(`Invite sent to ${iEmail.trim()}${data.emailed ? '' : ' (email may be delayed)'}.`);
      setInviteOpen(false); setIName(''); setIEmail(''); setIRole('admin'); setIDept('');
      await load();
    } catch (e) { toast('Failed: ' + (e as Error).message); }
    finally { setInviteBusy(false); }
  }

  async function saveRole() {
    if (!roleFor) return;
    setRoleBusy(true);
    try {
      await teamFetch('manage', { action: 'role', targetUserId: roleFor.user_id, role: roleVal });
      toast(`${roleFor.full_name} is now ${ROLE_LABEL[roleVal]}.`);
      setRoleFor(null);
      await load();
    } catch (e) { toast('Failed: ' + (e as Error).message); }
    finally { setRoleBusy(false); }
  }

  async function act(u: TeamUser, action: string, confirmOpts?: { title: string; body: string; confirmLabel: string; tone: 'danger' | 'primary' }) {
    if (confirmOpts && !(await confirm(confirmOpts))) return;
    setBusyId(u.user_id);
    try {
      const data = await teamFetch('manage', { action, targetUserId: u.user_id });
      const msg: Record<string, string> = { deactivate: `${u.full_name} deactivated.`, reactivate: `${u.full_name} reactivated.`, resend: `Invite resent${data.emailed === false ? ' (email may be delayed)' : ''}.`, cancel: 'Invite cancelled.', reset: `Reset link sent to ${u.full_name}.` };
      toast(msg[action] || 'Done.');
      await load();
    } catch (e) { toast('Failed: ' + (e as Error).message); }
    finally { setBusyId(''); }
  }

  function openRole(u: TeamUser) { setRoleVal(u.role); setRoleFor(u); }

  if (phase === 'loading' || phase === 'error') {
    return <div className="loading-screen">{phase === 'loading' && <div className="spinner" />}<div className="loading-text">{phase === 'error' ? errMsg : 'Loading team…'}</div></div>;
  }

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
          <a className="tab-btn" href="/admin"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, flexShrink: 0, marginRight: 7 }}><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /></svg> All Tickets</a>
          <a className="tab-btn" href="/admin/guides"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, flexShrink: 0, marginRight: 7 }}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg> Guides</a>
          <a className="tab-btn" href="/admin/analytics"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, flexShrink: 0, marginRight: 7 }}><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg> Analytics</a>
          <span className="tab-btn active"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, flexShrink: 0, marginRight: 7 }}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg> Team</span>
        </div>
        {isOwner && <button className="btn-primary" style={{ fontSize: 12, flexShrink: 0 }} onClick={() => setInviteOpen(true)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, marginRight: 6 }}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>Invite user</button>}
      </div>

      <div className="page-content">
        <div className="section-title" style={{ marginTop: 0, fontSize: 22, fontWeight: 600 }}>Team &amp; access <span className="section-badge">{users.length}</span></div>
        <div className="perm-note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          Only Owners can invite people, change roles, or deactivate accounts. Admins see this list but can&apos;t change it.
        </div>

        <div className="table-card">
          <div className="table-scroll">
            <table className="tm-table">
              <thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Status</th><th>Last active</th><th></th></tr></thead>
              <tbody>
                {users.map(u => {
                  const isSelf = u.user_id === viewerId;
                  const inactive = u.status === 'deactivated';
                  return (
                    <tr key={u.user_id} className={inactive ? 'tm-inactive-row' : undefined}>
                      <td><div className="u-name">{u.full_name}</div><div className="u-email">{u.email}</div></td>
                      <td><span className={`tm-badge ${ROLE_BADGE[u.role] || 'tm-admin'}`}>{ROLE_LABEL[u.role] || u.role}</span></td>
                      <td className="tm-dept">{u.department || '—'}</td>
                      <td>
                        {u.status === 'active' && <span className="tm-badge tm-active">Active</span>}
                        {u.status === 'invited' && <span className="tm-badge tm-invited">Invited</span>}
                        {u.status === 'deactivated' && <span className="tm-badge tm-inactive">Deactivated</span>}
                      </td>
                      <td className="tm-dept">{u.status === 'invited' ? '—' : (u.last_active ? fmtRelative(u.last_active) : 'Never')}</td>
                      <td className="tm-actions">
                        {isSelf ? <span className="tm-link muted">You</span> : !isOwner ? null : busyId === u.user_id ? <span className="tm-link muted">…</span> : (
                          u.status === 'invited' ? (<>
                            <button className="tm-link" onClick={() => act(u, 'resend')}>Resend invite</button>
                            <button className="tm-link muted" onClick={() => act(u, 'cancel', { title: `Cancel ${u.full_name}'s invite?`, body: 'This removes the pending invite. They will not be able to use the old link.', confirmLabel: 'Cancel invite', tone: 'danger' })}>Cancel</button>
                          </>) : u.status === 'deactivated' ? (
                            <button className="tm-link" onClick={() => act(u, 'reactivate')}>Reactivate</button>
                          ) : (<>
                            <button className="tm-link" onClick={() => openRole(u)}>Change role</button>
                            <button className="tm-link" onClick={() => act(u, 'reset', { title: `Reset ${u.full_name}'s password?`, body: 'They get an email with a link to set a new password. Their current password keeps working until they use it.', confirmLabel: 'Send reset', tone: 'primary' })}>Reset password</button>
                            <button className="tm-link danger" onClick={() => act(u, 'deactivate', { title: `Deactivate ${u.full_name}?`, body: 'They lose access immediately but stay on record (their name still shows on tickets they handled). You can reactivate any time.', confirmLabel: 'Deactivate', tone: 'danger' })}>Deactivate</button>
                          </>)
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

      {/* Invite modal */}
      {inviteOpen && (
        <div className="nt-overlay open" onMouseDown={(e) => { if (e.target === e.currentTarget && !inviteBusy) setInviteOpen(false); }}>
          <div className="nt-modal" style={{ maxWidth: 480 }}>
            <div className="nt-head">
              <div><div className="nt-title">Invite user</div><div className="nt-sub">They&apos;ll set their own password via an emailed link</div></div>
              <button className="nt-close" onClick={() => setInviteOpen(false)} aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
            </div>
            <div className="nt-body">
              <div className="nt-field"><label className="nt-label">Full name <span className="req">*</span></label><input className="nt-input" value={iName} onChange={(e) => setIName(e.target.value)} placeholder="e.g. Sam Carter" autoFocus /></div>
              <div className="nt-field"><label className="nt-label">Work email <span className="req">*</span></label><input className="nt-input" type="email" value={iEmail} onChange={(e) => setIEmail(e.target.value)} placeholder="name@homedelivery.com.au" /></div>
              <div className="nt-row-2">
                <div className="nt-field"><label className="nt-label">Role <span className="req">*</span></label>
                  <select className="nt-input" value={iRole} onChange={(e) => setIRole(e.target.value)}><option value="admin">Admin</option><option value="manager">Manager</option><option value="owner">Owner</option></select>
                </div>
                <div className="nt-field"><label className="nt-label">Department</label>
                  <select className="nt-input" value={iDept} onChange={(e) => setIDept(e.target.value)}><option value="">—</option>{DEPARTMENTS.map(d => <option key={d}>{d}</option>)}</select>
                </div>
              </div>
              <div className="invite-note">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                <span>An invite email goes to this address with a secure link to set their password. They won&apos;t have access until they accept. You never see or set their password.</span>
              </div>
            </div>
            <div className="nt-foot">
              <button className="nt-btn-ghost" onClick={() => setInviteOpen(false)} disabled={inviteBusy}>Cancel</button>
              <button className="nt-btn-primary" onClick={doInvite} disabled={inviteBusy}>{inviteBusy ? 'Sending…' : 'Send invite'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Change-role modal */}
      {roleFor && (
        <div className="nt-overlay open" onMouseDown={(e) => { if (e.target === e.currentTarget && !roleBusy) setRoleFor(null); }}>
          <div className="nt-modal" style={{ maxWidth: 420 }}>
            <div className="nt-head">
              <div><div className="nt-title">Change role</div><div className="nt-sub">{roleFor.full_name} · {roleFor.email}</div></div>
              <button className="nt-close" onClick={() => setRoleFor(null)} aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
            </div>
            <div className="nt-body">
              <div className="nt-field"><label className="nt-label">Role</label>
                <select className="nt-input" value={roleVal} onChange={(e) => setRoleVal(e.target.value)}><option value="admin">Admin</option><option value="manager">Manager</option><option value="owner">Owner</option></select>
              </div>
              <div className="invite-note">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                <span>Owner adds user-management powers on top of Admin. Manager is a department label only.</span>
              </div>
            </div>
            <div className="nt-foot">
              <button className="nt-btn-ghost" onClick={() => setRoleFor(null)} disabled={roleBusy}>Cancel</button>
              <button className="nt-btn-primary" onClick={saveRole} disabled={roleBusy}>{roleBusy ? 'Saving…' : 'Save role'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
