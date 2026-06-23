'use client';

import { useEffect, useRef, useState } from 'react';
import { sb } from '@/lib/supabase';
import { CAT_LABEL } from '@/lib/constants';
import type { Note } from '@/lib/types';

/* The purple "For this ticket" section on the help-guide rail. On demand, asks
   the AI (server-side, /api/ticket-questions) for clarifying questions specific
   to this ticket + a category-match check. AI drafts, the human acts: questions
   are tap-to-insert, the category mismatch is a one-tap suggestion. Fails to a
   quiet error — never blocks the rail. Copy says "AI", never "Claude". */

type Mismatch = { suggested: string; level: 'weak' | 'mismatch' };
type Status = 'idle' | 'loading' | 'done' | 'error';

const Sparkle = ({ cls }: { cls?: string }) => (
  <svg className={cls} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></svg>
);

export function GuideAISection({ ticketId, category, notes, onInsert, onSwitchCategory }: {
  ticketId: string;
  category: string;
  notes: Note[];
  onInsert: (text: string) => void;
  onSwitchCategory: (categoryKey: string) => void;
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [questions, setQuestions] = useState<string[]>([]);
  const [complete, setComplete] = useState(false);
  const [mismatch, setMismatch] = useState<Mismatch | null>(null);
  const [mismatchDismissed, setMismatchDismissed] = useState(false);
  const [error, setError] = useState('');
  // Inbound-reply count when we last ran — used to show the "re-check" nudge.
  const runInbound = useRef<number | null>(null);

  const inboundCount = notes.filter(n => n.note_type === 'inbound').length;
  const showRecheck = status === 'done' && runInbound.current != null && inboundCount > runInbound.current;

  // Lightweight category-fit check that fires automatically when a ticket opens,
  // so a miscategorisation flags itself without tapping Suggest. Once per ticket;
  // silent and best-effort (never blocks the rail). The full Suggest call later
  // returns its own fit and overrides this.
  const checkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (checkedRef.current === ticketId) return;
    checkedRef.current = ticketId;
    let on = true;
    (async () => {
      try {
        const { data: { session } } = await sb.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        const res = await fetch('/api/ticket-questions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ ticketId, mode: 'category' }),
        });
        const data = await res.json().catch(() => ({}));
        if (on && res.ok && data.ok && data.mismatch) { setMismatch(data.mismatch); setMismatchDismissed(false); }
      } catch { /* silent — category hint is best-effort */ }
    })();
    return () => { on = false; };
  }, [ticketId]);

  async function suggest() {
    setStatus('loading'); setError('');
    try {
      const { data: { session } } = await sb.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Session expired');
      const res = await fetch('/api/ticket-questions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ ticketId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setQuestions(Array.isArray(data.questions) ? data.questions : []);
      setComplete(!!data.complete);
      setMismatch(data.mismatch || null);
      setMismatchDismissed(false);
      runInbound.current = inboundCount;
      setStatus('done');
    } catch (err) {
      setError((err as Error).message || 'AI suggestions failed — ask manually.');
      setStatus('error');
    }
  }

  return (
    <div className="guide-section guide-purple">
      <div className="guide-ai-head">
        <span className="guide-section-title"><Sparkle cls="guide-ai-spark" /> For this ticket</span>
        <span className="guide-ai-tag">AI</span>
      </div>
      <div className="guide-section-body">
        {/* Category fit — one-tap, never automatic. 'weak' = quiet suggestion,
            'mismatch' = firmer amber flag. */}
        {mismatch && !mismatchDismissed && (
          mismatch.level === 'mismatch' ? (
            <div className="guide-ai-mismatch">
              <div>Filed under <strong>{CAT_LABEL[category] || category}</strong> but looks like <strong>{CAT_LABEL[mismatch.suggested] || mismatch.suggested}</strong>.</div>
              <div className="guide-ai-mismatch-actions">
                <button className="guide-ai-switch" onClick={() => { onSwitchCategory(mismatch.suggested); setMismatch(null); }}>Switch to {CAT_LABEL[mismatch.suggested] || mismatch.suggested}</button>
                <button className="guide-ai-keep" onClick={() => setMismatchDismissed(true)}>Keep</button>
              </div>
            </div>
          ) : (
            <div className="guide-ai-suggest">
              <span>This might fit better under <strong>{CAT_LABEL[mismatch.suggested] || mismatch.suggested}</strong>.</span>
              <span className="guide-ai-suggest-actions">
                <button className="guide-ai-suggest-switch" onClick={() => { onSwitchCategory(mismatch.suggested); setMismatch(null); }}>Switch</button>
                <button className="guide-ai-suggest-keep" onClick={() => setMismatchDismissed(true)}>Dismiss</button>
              </span>
            </div>
          )
        )}

        {status === 'idle' && (
          <>
            <p className="guide-ai-intro">Get AI-suggested questions specific to this ticket and its conversation.</p>
            <button className="guide-ai-btn" onClick={suggest}><Sparkle /> Suggest questions for this ticket</button>
          </>
        )}

        {status === 'loading' && (
          <button className="guide-ai-btn" disabled><span className="guide-ai-dots">Reading the ticket…</span></button>
        )}

        {status === 'error' && (
          <>
            <p className="guide-ai-err">{error}</p>
            <button className="guide-ai-btn" onClick={suggest}><Sparkle /> Try again</button>
          </>
        )}

        {status === 'done' && (
          <>
            {showRecheck && (
              <button className="guide-ai-recheck" onClick={suggest}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                New reply — re-check questions?
              </button>
            )}
            {complete && !questions.length ? (
              <p className="guide-ai-complete">Nothing obviously missing — this ticket looks complete.</p>
            ) : (
              <>
                <div className="guide-q-hint">Tap a question to add it to your reply.</div>
                <div className="guide-qs">
                  {questions.map((q, i) => (
                    <button key={i} className="guide-q guide-q-ai" onClick={() => onInsert(q)} title="Add to reply">
                      <Sparkle cls="guide-q-plus" />
                      <span>{q}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <button className="guide-ai-rerun" onClick={suggest}>Regenerate</button>
          </>
        )}
      </div>
    </div>
  );
}
