'use client';

/* Invite acceptance: the branded invite/recovery link lands here with a session
   (detectSessionInUrl). The user sets their own password (we never see it), then
   they're signed in and sent to /admin. */

import { useEffect, useState } from 'react';
import { sb } from '@/lib/supabase';

export default function SetPasswordPage() {
  const [phase, setPhase] = useState<'checking' | 'ready' | 'invalid'>('checking');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let settled = false;
    const ready = () => { if (!settled) { settled = true; setPhase('ready'); } };
    // The link's tokens are picked up async; catch them via the auth event too.
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => { if (session) ready(); });
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session) ready();
      else setTimeout(() => { if (!settled) setPhase('invalid'); }, 2500);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function save() {
    if (pass.length < 8) { setErr('Use at least 8 characters.'); return; }
    if (pass !== confirm) { setErr('The passwords don’t match.'); return; }
    setBusy(true); setErr('');
    try {
      const { error } = await sb.auth.updateUser({ password: pass });
      if (error) { setErr(error.message); return; }
      setDone(true);
      setTimeout(() => { window.location.href = '/admin'; }, 1200);
    } catch (e) {
      setErr((e as Error).message || 'Could not set your password.');
    } finally {
      setBusy(false);
    }
  }

  const onKey = (ev: React.KeyboardEvent) => { if (ev.key === 'Enter') save(); };

  return (
    <div className="login-page">
      <div className="login-wrap">
        <div className="login-header">
          <img src="https://cdn.prod.website-files.com/69d48f8e8f01871806e7f5c4/69dc2749d52c90cf97e32309_Secondary-positive.png" alt="HDS" className="login-logo" />
          <div className="login-title">Set your password</div>
          <div className="login-sub">Finish setting up your HDS IT Helpdesk account</div>
        </div>

        <div className="login-card">
          {phase === 'checking' && <div className="loading-text" style={{ textAlign: 'center', padding: 12 }}>Checking your invite…</div>}

          {phase === 'invalid' && (
            <div className="error-box show">This link is invalid or has expired. Ask an Owner to resend your invite.</div>
          )}

          {phase === 'ready' && !done && (
            <>
              <div className={`error-box${err ? ' show' : ''}`}>{err}</div>
              <div className="form-group">
                <label className="form-label">New password</label>
                <input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" onKeyDown={onKey} autoFocus />
              </div>
              <div className="form-group" style={{ marginBottom: 24 }}>
                <label className="form-label">Confirm password</label>
                <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" onKeyDown={onKey} />
              </div>
              <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Set password & sign in →'}</button>
            </>
          )}

          {done && <div className="loading-text" style={{ textAlign: 'center', padding: 12, color: '#2E7D52' }}>Password set. Signing you in…</div>}
        </div>

        <div className="login-footer"><a href="/login">← Staff login</a></div>
      </div>
    </div>
  );
}
