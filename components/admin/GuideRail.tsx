'use client';

import { useState } from 'react';
import { CAT_LABEL } from '@/lib/constants';
import { fmtRelative } from '@/lib/format';
import { GuideAISection } from '@/components/admin/GuideAISection';
import type { HelpGuide } from '@/lib/guides';
import type { Note } from '@/lib/types';

/* The help-guide rail in the admin ticket modal. Phase 1: static, editable
   knowledge bank — clarifying questions (tap-to-insert) + numbered resolution
   steps. The purple "For this ticket" section is a PHASE-2 slot (layout only).
   Used both as the desktop 3rd column (variant 'rail', collapsible to a strip)
   and the mobile "Guide" tab (variant 'panel'). */

const Book = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
);
const Chevron = ({ open }: { open: boolean }) => (
  <svg className="guide-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'none' : 'rotate(-90deg)' }}><polyline points="6 9 12 15 18 9" /></svg>
);

function Section({ title, accent, defaultOpen = true, children }: { title: React.ReactNode; accent: 'blue' | 'purple'; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`guide-section guide-${accent}`}>
      <button className="guide-section-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="guide-section-title">{title}</span>
        <Chevron open={open} />
      </button>
      {open && <div className="guide-section-body">{children}</div>}
    </div>
  );
}

export function GuideRail({ guide, loading, ticketId, category, notes, isAdmin, variant = 'rail', collapsed = false, onToggleCollapse, onInsert, onSwitchCategory, onEdit, onCreate }: {
  guide: HelpGuide | null;
  loading: boolean;
  ticketId: string;
  category: string;
  notes: Note[];
  isAdmin: boolean;
  variant?: 'rail' | 'panel';
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onInsert: (text: string) => void;
  onSwitchCategory: (categoryKey: string) => void;
  onEdit: () => void;
  onCreate: () => void;
}) {
  const catLabel = CAT_LABEL[category] || category;

  // Collapsed strip (desktop only) — click anywhere to expand.
  if (variant === 'rail' && collapsed) {
    return (
      <aside className="guide-rail guide-rail-min" onClick={onToggleCollapse} title="Show help guide">
        <button className="guide-strip-btn" aria-label="Show help guide">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span className="guide-strip-label">GUIDE</span>
      </aside>
    );
  }

  return (
    <aside className={`guide-rail${variant === 'panel' ? ' guide-panel' : ''}`}>
      <div className="guide-rail-head">
        <span className="guide-rail-head-ico"><Book /></span>
        <div className="guide-rail-head-main">
          <div className="guide-rail-title">{guide ? guide.title : 'Help guide'}</div>
          <div className="guide-rail-meta">
            {guide ? <>{catLabel} · used on {guide.usage_count} {guide.usage_count === 1 ? 'ticket' : 'tickets'}</> : catLabel}
          </div>
        </div>
        {variant === 'rail' && onToggleCollapse && (
          <button className="guide-collapse-btn" onClick={onToggleCollapse} aria-label="Collapse guide" title="Collapse">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        )}
      </div>

      <div className="guide-rail-body">
        {loading ? (
          <div className="guide-loading">Loading guide…</div>
        ) : (
          <>
            {/* AI "For this ticket" — on-demand, ticket-specific (phase 2). */}
            <GuideAISection ticketId={ticketId} category={category} notes={notes} onInsert={onInsert} onSwitchCategory={onSwitchCategory} />

            {!guide ? (
              // Empty state — no static guide yet (common early on).
              <div className="guide-empty">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#8A97A8' }}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                <div className="guide-empty-title">No saved guide for {catLabel}</div>
                <div className="guide-empty-sub">Capture the questions to ask and the steps to resolve it — the next person (or you) will thank you.</div>
                {isAdmin && <button className="btn-primary" style={{ fontSize: 12 }} onClick={onCreate}>Write the first guide</button>}
              </div>
            ) : (
          <>
            {/* Static clarifying questions — tap to insert into the reply composer. */}
            {guide.questions.length > 0 && (
              <Section accent="blue" title={<>Confirm before starting</>}>
                <div className="guide-q-hint">Tap a question to add it to your reply.</div>
                <div className="guide-qs">
                  {guide.questions.map((q, i) => (
                    <button key={i} className="guide-q" onClick={() => onInsert(q)} title="Add to reply">
                      <svg className="guide-q-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      <span>{q}</span>
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {/* Resolution steps — plain numbered list (no checkboxes / done-state). */}
            {guide.steps.length > 0 && (
              <Section accent="blue" title={<>Resolution steps</>}>
                <ol className="guide-steps">
                  {guide.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </Section>
            )}

            <div className="guide-footer">
              <span>Updated {fmtRelative(guide.updated_at)}{guide.updated_by ? ` · by ${guide.updated_by}` : ''}</span>
              {isAdmin && <button className="guide-edit-link" onClick={onEdit}>Edit guide →</button>}
            </div>
          </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
