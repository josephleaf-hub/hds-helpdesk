'use client';

/* Port of login.html — IT staff (admin/manager) sign-in via email + password.
   On success, verifies a user_roles row exists, then redirects to /admin. */

import { useEffect, useState } from 'react';
import { sb } from '@/lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  // Already signed in → straight to the dashboard.
  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session) window.location.href = '/admin';
    });
  }, []);

  async function doLogin() {
    const e = email.trim();
    if (!e || !pass) { setErr('Please enter your email and password.'); return; }
    setBusy(true); setErr('');
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: e, password: pass });
      if (error) { setErr(error.message); return; }

      const { data: roleData, error: roleErr } = await sb
        .from('user_roles').select('role, department, full_name').eq('user_id', data.user.id).single();
      if (roleErr || !roleData) {
        await sb.auth.signOut();
        setErr('Your account does not have IT staff access. Contact the IT Manager.');
        return;
      }
      window.location.href = '/admin';
    } catch (e2) {
      setErr((e2 as Error).message || 'Login failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    const e = email.trim();
    if (!e || !e.includes('@')) { setErr('Enter your email above first, then tap “Forgot password?”.'); return; }
    setResetBusy(true); setErr(''); setResetMsg('');
    try {
      const res = await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e }) });
      const data = await res.json().catch(() => ({}));
      setResetMsg(data.message || 'If that account exists, we’ve emailed a password reset link.');
    } catch {
      setResetMsg('If that account exists, we’ve emailed a password reset link.');
    } finally {
      setResetBusy(false);
    }
  }

  const onKey = (ev: React.KeyboardEvent) => { if (ev.key === 'Enter') doLogin(); };

  return (
    <div className="login-page">
      <div className="login-wrap">
        <div className="login-header">
          <img src="https://cdn.prod.website-files.com/69d48f8e8f01871806e7f5c4/69dc2749d52c90cf97e32309_Secondary-positive.png" alt="HDS" className="login-logo" />
          <div className="login-title">IT Staff Login</div>
          <div className="login-sub">Admin &amp; Manager access only</div>
        </div>

        <div className="login-card">
          <div className={`error-box${err ? ' show' : ''}`}>{err}</div>

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="name@homedelivery.com.au" autoComplete="email" onKeyDown={onKey} />
          </div>
          <div className="form-group" style={{ marginBottom: 24 }}>
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Password
              <button type="button" onClick={forgotPassword} disabled={resetBusy} style={{ background: 'none', border: 'none', padding: 0, color: '#1C64F2', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>{resetBusy ? 'Sending…' : 'Forgot password?'}</button>
            </label>
            <input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)}
              placeholder="••••••••" autoComplete="current-password" onKeyDown={onKey} />
          </div>

          {resetMsg && <div style={{ background: '#E8F5EE', color: '#2E7D52', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5, marginBottom: 16 }}>{resetMsg}</div>}

          <button className="btn-primary" onClick={doLogin} disabled={busy}>{busy ? 'Signing in…' : 'Sign In →'}</button>
        </div>

        <div className="login-footer"><a href="/">← Back to Staff Portal</a></div>
      </div>
    </div>
  );
}
