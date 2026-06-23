'use client';

import { useEffect, useState } from 'react';
import { KNOWLEDGE_SECTIONS, getKnowledge, saveKnowledge, type KnowledgeMap } from '@/lib/orgKnowledge';
import { useToast } from '@/components/Toast';

/* "House knowledge" panel on the Guides page. Admins record HDS facts and
   conventions (email domains, naming, licences, AD/OUs, how-we-do-things); the
   AI features read them so they use real values instead of [bracket] gaps.
   Admin-editable; managers see it read-only. */

export function HouseKnowledge({ isAdmin, userName }: { isAdmin: boolean; userName: string }) {
  const toast = useToast();
  const [map, setMap] = useState<KnowledgeMap>({});
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { getKnowledge().then(setMap); }, []);

  const filled = KNOWLEDGE_SECTIONS.filter(s => (map[s.key] || '').trim()).length;

  function edit(key: string, val: string) { setMap(m => ({ ...m, [key]: val })); setDirty(true); }

  async function save() {
    setSaving(true);
    try {
      // Persist every section (upsert handles create + update).
      await Promise.all(KNOWLEDGE_SECTIONS.map(s => saveKnowledge(s.key, map[s.key] || '', userName)));
      toast('House knowledge saved.');
      setDirty(false);
    } catch (err) {
      toast('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="house-panel">
      <button className="house-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="house-head-main">
          <svg className="house-ico" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
          <span>
            <span className="house-title">House knowledge</span>
            <span className="house-sub">What the AI should know about how HDS works — domains, licences, naming, conventions</span>
          </span>
        </span>
        <span className="house-head-right">
          <span className="section-badge">{filled}/{KNOWLEDGE_SECTIONS.length}</span>
          <svg className="house-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'none' : 'rotate(-90deg)' }}><polyline points="6 9 12 15 18 9" /></svg>
        </span>
      </button>

      {open && (
        <div className="house-body">
          {!isAdmin && <div className="house-readonly">Read-only — ask an admin to update the house knowledge.</div>}
          <div className="house-grid">
            {KNOWLEDGE_SECTIONS.map(s => (
              <div key={s.key} className="house-field">
                <label className="house-label">{s.label}</label>
                <div className="house-hint">{s.hint}</div>
                <textarea
                  className="house-input"
                  value={map[s.key] || ''}
                  onChange={(e) => edit(s.key, e.target.value)}
                  placeholder={s.placeholder}
                  disabled={!isAdmin}
                  rows={4}
                />
              </div>
            ))}
          </div>
          {isAdmin && (
            <div className="house-actions">
              <button className="btn-primary" style={{ fontSize: 12 }} onClick={save} disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save knowledge'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
