'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { sb } from '@/lib/supabase';

/* In-page real-time alerts over Supabase Realtime (no polling). RLS scopes the
   events: admins/managers hear all tickets/replies; a requester only hears IT
   replies on their own tickets. One provider per surface (admin | requester).
   Owns: toast stack, subtle chime, persisted mute, and (admin) the tab-title
   badge + "new since you were away" bar. */

type Surface = 'admin' | 'requester';
type AlertKind = 'new' | 'reply' | 'it';
type Alert = { id: number; kind: AlertKind; title: string; body?: string; ticketId?: string };

const MUTE_KEY = 'hds-alert-muted';
const MuteCtx = createContext<{ muted: boolean; toggle: () => void; awayBar: number; clearAway: () => void }>({ muted: false, toggle: () => {}, awayBar: 0, clearAway: () => {} });
export const useAlertMute = () => useContext(MuteCtx);

// Short two-note chime (Web Audio). Low gain, fails silently if autoplay-blocked.
let _audio: AudioContext | null = null;
function ensureAudio() {
  try { _audio = _audio || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); if (_audio.state === 'suspended') _audio.resume(); } catch { /* blocked */ }
}
function playChime() {
  try {
    ensureAudio();
    if (!_audio) return;
    const ctx = _audio; const now = ctx.currentTime;
    [880, 1245].forEach((f, i) => {
      const t = now + i * 0.11;
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.18);
    });
  } catch { /* blocked — visual toast still shows */ }
}

export function RealtimeAlertsProvider({ surface, enabled, onView, onActivity, children }: {
  surface: Surface; enabled: boolean; onView?: (ticketId: string) => void; onActivity?: () => void; children: React.ReactNode;
}) {
  const [muted, setMuted] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [awayBar, setAwayBar] = useState(0);
  const mutedRef = useRef(false);
  const interacted = useRef(false);
  const awayRef = useRef(0);
  const idRef = useRef(0);
  const baseTitle = useRef('');
  const onViewRef = useRef(onView); onViewRef.current = onView;
  const onActivityRef = useRef(onActivity); onActivityRef.current = onActivity;

  useEffect(() => {
    try { if (localStorage.getItem(MUTE_KEY) === '1') { setMuted(true); mutedRef.current = true; } } catch { /* ignore */ }
    baseTitle.current = document.title;
  }, []);

  const toggle = useCallback(() => {
    setMuted(m => { const next = !m; mutedRef.current = next; try { localStorage.setItem(MUTE_KEY, next ? '1' : '0'); } catch { /* ignore */ } return next; });
  }, []);

  // Unlock audio on first interaction (browser autoplay policy).
  useEffect(() => {
    const unlock = () => { interacted.current = true; ensureAudio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);

  const dismiss = useCallback((id: number) => setAlerts(a => a.filter(x => x.id !== id)), []);

  const fire = useCallback((kind: AlertKind, title: string, body: string | undefined, ticketId?: string) => {
    const id = ++idRef.current;
    setAlerts(a => [...a.slice(-3), { id, kind, title, body, ticketId }]);   // keep at most 4 stacked
    setTimeout(() => dismiss(id), 5200);
    if (!mutedRef.current && interacted.current) playChime();
    if (surface === 'admin' && document.hidden) {
      awayRef.current += 1;
      document.title = `(${awayRef.current}) ${baseTitle.current}`;
    }
    onActivityRef.current?.();
  }, [surface, dismiss]);

  // Realtime subscription (cleaned up on unmount).
  useEffect(() => {
    if (!enabled) return;
    const ch = sb.channel(`rt-alerts-${surface}`);
    if (surface === 'admin') {
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets' }, (p) => {
        const t = p.new as { id?: string; subject?: string };
        if (t?.id) fire('new', `New ticket · ${t.id}`, t.subject, t.id);
      });
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ticket_notes' }, (p) => {
        const n = p.new as { note_type?: string; ticket_id?: string; note_text?: string };
        if (n?.note_type === 'inbound') fire('reply', `New reply · ${n.ticket_id}`, (n.note_text || '').slice(0, 90), n.ticket_id);
      });
    } else {
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ticket_notes' }, (p) => {
        const n = p.new as { note_type?: string; ticket_id?: string; note_text?: string };
        if (n?.note_type === 'outbound') fire('it', 'HDS IT Helpdesk replied', (n.note_text || '').slice(0, 90), n.ticket_id);
      });
    }
    ch.subscribe();
    return () => { sb.removeChannel(ch); };
  }, [enabled, surface, fire]);

  // Page Visibility → clear badge + raise the away-bar on return (admin only).
  useEffect(() => {
    if (surface !== 'admin') return;
    const onVis = () => {
      if (!document.hidden) {
        if (awayRef.current > 0) { setAwayBar(awayRef.current); awayRef.current = 0; }
        document.title = baseTitle.current;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [surface]);

  const clearAway = useCallback(() => setAwayBar(0), []);

  return (
    <MuteCtx.Provider value={{ muted, toggle, awayBar: surface === 'admin' ? awayBar : 0, clearAway }}>
      {children}

      <div className="alert-toasts">
        {alerts.map(a => (
          <div key={a.id} className={`alert-toast alert-${a.kind}`}>
            <div className="alert-toast-body">
              <div className="alert-toast-title">{a.title}</div>
              {a.body && <div className="alert-toast-text">{a.body}</div>}
            </div>
            {a.ticketId && onViewRef.current && <button className="alert-toast-view" onClick={() => { onViewRef.current!(a.ticketId!); dismiss(a.id); }}>View</button>}
            <button className="alert-toast-x" onClick={() => dismiss(a.id)} aria-label="Dismiss">✕</button>
          </div>
        ))}
      </div>
    </MuteCtx.Provider>
  );
}

// Inline banner — render it in the page content where you want it (e.g. above
// the ticket table). Shows only after returning to a tab that had activity.
export function AwayBar() {
  const { awayBar, clearAway } = useAlertMute();
  if (awayBar <= 0) return null;
  return (
    <div className="alert-awaybar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
      <span>{awayBar} new {awayBar === 1 ? 'update' : 'updates'} while you were away</span>
      <button onClick={clearAway} aria-label="Dismiss">✕</button>
    </div>
  );
}

export function MuteToggle() {
  const { muted, toggle } = useAlertMute();
  return (
    <button className="mute-toggle" onClick={toggle} title={muted ? 'Unmute alerts' : 'Mute alerts'} aria-label={muted ? 'Unmute alerts' : 'Mute alerts'}>
      {muted ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0" /><path d="M18.63 13A17.89 17.89 0 0 1 18 8" /><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" /><path d="M18 8a6 6 0 0 0-9.33-5" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
      )}
    </button>
  );
}
