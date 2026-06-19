'use client';

/* PHASE 1 STUB — exists only to prove the magic-link / portable-token
   round-trip works end-to-end on the preview. The real portal replaces this
   in Phase 3. */

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { sb } from '@/lib/supabase';

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    if (new URLSearchParams(window.location.search).get('signin') === 'expired') {
      setMsg('That sign-in link is no longer valid — request a new one below.');
    }
    return () => sub.subscription.unsubscribe();
  }, []);

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg('');
    try {
      const r = await fetch('/api/regenerate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to send link');
      setSent(true);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await sb.auth.signOut();
    setUser(null);
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 20, boxShadow: 'var(--shadow-card)', padding: 28, width: '100%', maxWidth: 420 }}>
        <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>HDS IT Helpdesk</div>
        <div style={{ fontSize: 13, color: 'var(--caption)', marginBottom: 20 }}>Next.js migration · Phase 1 auth check</div>

        {!ready ? (
          <div style={{ color: 'var(--caption)', fontSize: 13 }}>Checking session…</div>
        ) : user ? (
          <div>
            <div style={{ fontSize: 14, marginBottom: 6 }}>Signed in as</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 18 }}>{user.email}</div>
            <button className="btn-secondary" onClick={signOut}>Sign out</button>
          </div>
        ) : sent ? (
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            Check <strong>{email}</strong> for a sign-in link. Click it to complete the round-trip.
          </div>
        ) : (
          <form onSubmit={requestLink}>
            <label className="form-label">Work email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@homedelivery.com.au"
              style={{ marginBottom: 14 }}
            />
            <button className="btn-primary btn-block" type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </form>
        )}

        {msg && <div style={{ marginTop: 14, fontSize: 12, color: 'var(--error)' }}>{msg}</div>}
      </div>
    </main>
  );
}
