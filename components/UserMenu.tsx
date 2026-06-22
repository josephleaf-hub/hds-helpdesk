'use client';

import { useState } from 'react';
import { sb } from '@/lib/supabase';
import { FloatingMenu } from '@/components/admin/FloatingMenu';

/* The user pill, as a dropdown: click it to reveal "Sign out".
   variant 'admin'  → white pill with a role dot (admin dashboard + analytics).
   variant 'portal' → pill with a person icon + email (requester portal).
   redirectTo: where to go after sign-out (staff → '/login'); omit on the portal,
   where the auth listener drops the user back to the public view. */
export function UserMenu({ label, variant = 'admin', manager = false, redirectTo }: {
  label: string; variant?: 'admin' | 'portal'; manager?: boolean; redirectTo?: string;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const toggle = (e: React.MouseEvent) => { const r = e.currentTarget.getBoundingClientRect(); setRect(prev => prev ? null : r); };

  async function signOut() {
    setRect(null);
    await sb.auth.signOut();
    if (redirectTo) window.location.href = redirectTo;
  }

  const chevron = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 2, color: '#8A97A8', flexShrink: 0 }}><polyline points="6 9 12 15 18 9" /></svg>
  );

  return (
    <>
      {variant === 'portal' ? (
        <span className="user-pill" style={{ cursor: 'pointer' }} onClick={toggle}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
          <span className="pt-email">{label}</span>
          {chevron}
        </span>
      ) : (
        <div className="admin-user-pill" style={{ cursor: 'pointer' }} onClick={toggle}>
          <span className={`admin-role-dot${manager ? ' mgr' : ''}`} />
          <span>{label}</span>
          {chevron}
        </div>
      )}
      {rect && <FloatingMenu rect={rect} minWidth={150} align="right" onClose={() => setRect(null)}
        items={[{ label: 'Sign out', color: '#C0392B', onClick: signOut }]} />}
    </>
  );
}
