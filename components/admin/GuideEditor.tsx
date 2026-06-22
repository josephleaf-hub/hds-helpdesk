'use client';

import { useState } from 'react';
import { CAT_LABEL, SUB_TYPES } from '@/lib/constants';
import { saveGuide, type HelpGuide } from '@/lib/guides';
import { useToast } from '@/components/Toast';

/* Create / edit a help guide. Reachable from the rail's "Edit guide →", the
   empty-state "Write the first guide", and the /admin/guides library. Admin-only
   (gated by the callers + RLS). Simple repeatable input rows for v1. */

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
          <div className="nt-group">
            <div className="nt-group-label">Applies to</div>
            <div className="nt-row-2">
              <div className="nt-field">
                <label className="nt-label">Category <span className="req">*</span></label>
                <select className="nt-input" value={category} onChange={(e) => { setCategory(e.target.value); setSubType(''); }}>
                  <option value="">—</option>
                  {Object.entries(CAT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="nt-field">
                <label className="nt-label">Sub-type</label>
                <select className="nt-input" value={subType} onChange={(e) => setSubType(e.target.value)}>
                  <option value="">All of {category ? (CAT_LABEL[category] || category) : 'category'}</option>
                  {(SUB_TYPES[category] || []).map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="nt-hint">Leave sub-type blank for a category-wide guide. A sub-type-specific guide takes priority when it matches.</div>
          </div>

          <div className="nt-field">
            <label className="nt-label">Title <span className="req">*</span></label>
            <input className="nt-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. New Starter Setup" autoFocus />
          </div>

          <RepeatList label="Confirm before starting" hint="Clarifying questions to ask the requester." items={questions} setItems={setQuestions} placeholder="e.g. Which systems do they need access to?" />
          <RepeatList label="Resolution steps" hint="Ordered steps to resolve it." items={steps} setItems={setSteps} placeholder="e.g. Create the AD account in the correct OU" ordered />
        </div>

        <div className="nt-foot">
          <button className="nt-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="nt-btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : (guide?.id ? 'Save changes' : 'Create guide')}</button>
        </div>
      </div>
    </div>
  );
}

// Repeatable text rows with add / remove / reorder.
function RepeatList({ label, hint, items, setItems, placeholder, ordered }: {
  label: string; hint: string; items: string[]; setItems: (v: string[]) => void; placeholder: string; ordered?: boolean;
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
          <input className="nt-input" value={val} onChange={(e) => set(i, e.target.value)} placeholder={placeholder} />
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
