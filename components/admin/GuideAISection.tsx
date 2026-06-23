'use client';

import { useRef, useState } from 'react';
import { sb } from '@/lib/supabase';
import type { Note } from '@/lib/types';

/* The purple "For this ticket" section on the help-guide rail. On demand, asks
   the AI (server-side, /api/ticket-questions) for clarifying questions specific
   to this ticket. Questions are tap-to-insert. The call also returns a
   category-fit verdict, which we hand up via onMismatch — the modal renders that
   as a top-bar banner (the modal also auto-checks fit on open). Fails to a quiet
   error, never blocks the rail. Copy says "AI", never "Claude". */

type Mismatch = { suggested: string; suggestedSubType?: string; level: 'weak' | 'mismatch' };
type Status = 'idle' | 'loading' | 'done' | 'error';

const Sparkle = ({ cls }: { cls?: string }) => (
  <svg className={cls} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></svg>
);

export function GuideAISection({ ticketId, notes, onInsert, onMismatch }: {
  ticketId: string;
  notes: Note[];
  onInsert: (text: string) => void;
  onMismatch: (m: Mismatch | null) => void;
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [questions, setQuestions] = useState<string[]>([]);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  // Inbound-reply count when we last ran — used to show the "re-check" nudge.
  const runInbound = useRef<number | null>(null);

  const inboundCount = notes.filter(n => n.note_type === 'inbound').length;
  const showRecheck = status === 'done' && runInbound.current != null && inboundCount > runInbound.current;

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
      onMismatch(data.mismatch || null);   // refresh the top-bar banner with the fuller read
      runInbound.current = inboundCount;
      setStatus('done');
    } catch (err) {
      setError((err as Error).message || 'AI suggestions failed. Ask manually.');
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
                New reply, re-check questions?
              </button>
            )}
            {complete && !questions.length ? (
              <p className="guide-ai-complete">Nothing obviously missing. This ticket looks complete.</p>
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
