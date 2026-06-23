'use client';

import { useState } from 'react';
import { sb } from '@/lib/supabase';
import { CAT_LABEL, SUB_TYPES } from '@/lib/constants';
import { saveGuide, type HelpGuide } from '@/lib/guides';
import { useToast } from '@/components/Toast';

/* Create / edit a help guide. Reachable from the rail's "Edit guide →", the
   empty-state "Write the first guide", and the /admin/guides library. Admin-only
   (gated by the callers + RLS). Includes "Draft with AI" — it FILLS the form
   (title/questions/steps + a suggested category) as editable content; nothing
   saves until the admin clicks Create/Save. Copy says "AI", never "Claude". */

const hasGap = (s: string) => /\[[^\]]+\]/.test(s);

export function GuideEditor({ guide, preset, userName, onClose, onSaved }: {
  guide?: HelpGuide | null;
  preset?: { category: string; sub_type: string | null };
  userName: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const toast = useToast();
  const [category, setCategory] = useState(guide?.category || preset?.category || '');
  const [subType, setSubType] = useState(guide?.sub_type || preset?.sub_type || '');
  const [title, setTitle] = useState(guide?.title || '');
  const [questions, setQuestions] = useState<string[]>(guide?.questions?.length ? guide.questions : ['']);
  const [steps, setSteps] = useState<string[]>(guide?.steps?.length ? guide.steps : ['']);
  const [busy, setBusy] = useState(false);

  // ── Draft with AI ──
  const [prompt, setPrompt] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [drafted, setDrafted] = useState(false);
  const [aiCategory, setAiCategory] = useState(false);           // category came from AI → show confirm pill
  const [mismatch, setMismatch] = useState<{ suggested: string } | null>(null);
  const [flash, setFlash] = useState(false);                     // flash filled fields after a draft

  const gaps = drafted && (steps.some(hasGap) || questions.some(hasGap));

  function pickCategory(c: string) { setCategory(c); setSubType(''); setAiCategory(false); setMismatch(null); }

  async function draft() {
    const p = prompt.trim();
    if (!p) { toast('Describe the task first.'); return; }
    setDrafting(true); setDraftError('');
    const hadCategory = !!category;
    try {
      const { data: { session } } = await sb.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Session expired — please sign in again.');
      const r = await fetch('/api/draft-guide', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ prompt: p, category: category || undefined, subType: subType || undefined }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || ('HTTP ' + r.status));
      const d = data.draft as { title: string; suggestedCategory: string; suggestedSubType: string; questions: string[]; steps: string[]; mismatch: boolean; mismatchCategory: string };

      if (d.title) setTitle(d.title);
      if (d.questions?.length) setQuestions(d.questions);
      if (d.steps?.length) setSteps(d.steps);
      // Category: never auto-switch over an admin's pick. If they hadn't chosen one,
      // adopt the AI suggestion (with a confirm pill). If they had and it mismatches,
      // surface the banner and leave their choice intact.
      if (d.mismatch && hadCategory) {
        setMismatch({ suggested: d.mismatchCategory });
      } else if (!hadCategory && d.suggestedCategory) {
        setCategory(d.suggestedCategory); setSubType(d.suggestedSubType || ''); setAiCategory(true);
      }
      setDrafted(true);
      setFlash(true); setTimeout(() => setFlash(false), 1200);
    } catch (err) {
      setDraftError((err as Error).message || 'AI drafting failed — write the guide manually.');
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    if (!category) { toast('Pick a category.'); return; }
    if (!title.trim()) { toast('Give the guide a title.'); return; }
    const qs = questions.map(q => q.trim()).filter(Boolean);
    const st = steps.map(s => s.trim()).filter(Boolean);
    if (!qs.length && !st.length) { toast('Add at least one question or step.'); return; }
    setBusy(true);
    try {
      const id = await saveGuide({ category, sub_type: subType || null, title, questions: qs, steps: st, updated_by: userName }, guide?.id);
      toast(guide?.id ? 'Guide updated.' : 'Guide created.');
      onSaved(id);
    } catch (err) {
      toast('Failed: ' + (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="nt-overlay open" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="nt-modal">
        <div className="nt-head">
          <div>
            <div className="nt-title">{guide?.id ? 'Edit guide' : 'New guide'}</div>
            <div className="nt-sub">Clarifying questions and resolution steps for a ticket type</div>
          </div>
          <button className="nt-close" onClick={onClose} aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>

        <div className="nt-body">
          {/* Draft with AI — fills the form below as editable suggestions */}
          {!guide?.id && (
            <div className="nt-draft">
              <div className="nt-draft-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></svg>
                Draft with AI
              </div>
              <textarea className="nt-input" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the task this guide should cover — e.g. 'Setting up a new starter: accounts, access, hardware and induction.' The fields below fill in as editable suggestions." />
              <div className="nt-draft-actions">
                <button type="button" className="btn-draft" onClick={draft} disabled={drafting || !prompt.trim()}>
                  {drafting ? 'Drafting…' : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></svg> Draft with AI</>}
                </button>
                {draftError && <span className="nt-draft-err">{draftError}</span>}
              </div>
            </div>
          )}

          {drafted && (
            <div className="nt-draft-banner">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
              Drafted by AI — review before saving.{gaps ? ' Anything in [brackets] needs your HDS-specific detail.' : ''} Nothing is saved until you click {guide?.id ? 'Save' : 'Create'}.
            </div>
          )}

          <div className="nt-group">
            <div className="nt-group-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              Applies to
              {aiCategory && <span className="ge-ai-pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></svg> Suggested by AI — confirm</span>}
            </div>
            {mismatch && (
              <div className="ge-mismatch">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                <div className="ge-mismatch-main">
                  <div>This reads like <strong>{CAT_LABEL[mismatch.suggested] || mismatch.suggested}</strong>, not <strong>{CAT_LABEL[category] || category}</strong>.</div>
                  <div className="ge-mismatch-actions">
                    <button type="button" onClick={() => { setCategory(mismatch.suggested); setSubType(''); setAiCategory(true); setMismatch(null); }}>Switch to {CAT_LABEL[mismatch.suggested] || mismatch.suggested}</button>
                    <button type="button" className="ge-mismatch-keep" onClick={() => setMismatch(null)}>Keep {CAT_LABEL[category] || category}</button>
                  </div>
                </div>
              </div>
            )}
            <div className="nt-row-2">
              <div className="nt-field">
                <label className="nt-label">Category <span className="req">*</span></label>
                <select className={'nt-input' + (flash ? ' ge-flash' : '')} value={category} onChange={(e) => pickCategory(e.target.value)}>
                  <option value="">—</option>
                  {Object.entries(CAT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="nt-field">
                <label className="nt-label">Sub-type</label>
                <select className="nt-input" value={subType} onChange={(e) => { setSubType(e.target.value); setAiCategory(false); }}>
                  <option value="">All of {category ? (CAT_LABEL[category] || category) : 'category'}</option>
                  {(SUB_TYPES[category] || []).map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="nt-hint">Leave sub-type blank for a category-wide guide. A sub-type-specific guide takes priority when it matches.</div>
          </div>

          <div className="nt-field">
            <label className="nt-label">Title <span className="req">*</span></label>
            <input className={'nt-input' + (flash ? ' ge-flash' : '')} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. New Starter Setup" autoFocus />
          </div>

          <RepeatList label="Confirm before starting" hint="Clarifying questions to ask the requester." items={questions} setItems={setQuestions} placeholder="e.g. Which systems do they need access to?" flash={flash} />
          <RepeatList label="Resolution steps" hint="Ordered steps to resolve it." items={steps} setItems={setSteps} placeholder="e.g. Create the AD account in the correct OU" ordered flash={flash} highlightGaps />
        </div>

        <div className="nt-foot">
          <button className="nt-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="nt-btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : (guide?.id ? 'Save changes' : 'Create guide')}</button>
        </div>
      </div>
    </div>
  );
}

// Repeatable text rows with add / remove / reorder. Optionally numbers them,
// flashes on AI fill, and highlights [bracketed] HDS-specific gaps in amber.
function RepeatList({ label, hint, items, setItems, placeholder, ordered, flash, highlightGaps }: {
  label: string; hint: string; items: string[]; setItems: (v: string[]) => void; placeholder: string; ordered?: boolean; flash?: boolean; highlightGaps?: boolean;
}) {
  const set = (i: number, v: string) => setItems(items.map((x, j) => j === i ? v : x));
  const add = () => setItems([...items, '']);
  const remove = (i: number) => setItems(items.length > 1 ? items.filter((_, j) => j !== i) : ['']);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };
  return (
    <div className="nt-group">
      <div className="nt-group-label">{label}</div>
      <div className="nt-hint" style={{ marginTop: -2, marginBottom: 8 }}>{hint}</div>
      {items.map((val, i) => (
        <div key={i} className="ge-row">
          {ordered && <span className="ge-row-num">{i + 1}</span>}
          <input className={'nt-input' + (flash ? ' ge-flash' : '') + (highlightGaps && hasGap(val) ? ' ge-input-gap' : '')} value={val} onChange={(e) => set(i, e.target.value)} placeholder={placeholder} />
          <div className="ge-row-btns">
            <button type="button" className="ge-row-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" title="Move up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg></button>
            <button type="button" className="ge-row-btn" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move down" title="Move down"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg></button>
            <button type="button" className="ge-row-btn ge-row-del" onClick={() => remove(i)} aria-label="Remove" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
          </div>
        </div>
      ))}
      <button type="button" className="ge-add" onClick={add}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        Add {ordered ? 'step' : 'question'}
      </button>
    </div>
  );
}
