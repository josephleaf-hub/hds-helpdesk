import { fmtDate } from '@/lib/format';
import type { Note, NoteType, AttachItem, AttachMap } from '@/lib/types';

const NOTE_STYLE: Record<NoteType, { color: string; bg: string; border: string }> = {
  outbound: { color: '#1C64F2', bg: '#EBF2FF', border: '#1C64F2' },
  inbound:  { color: '#C24824', bg: '#FFF3EF', border: '#FF6B43' },
  internal: { color: '#6B7280', bg: '#F8F9FA', border: '#C8D4DF' },
};

function NoteIcon({ type, color }: { type: NoteType; color: string }) {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: { verticalAlign: -2, flexShrink: 0, marginRight: 5, color } };
  if (type === 'outbound') return <svg {...common}><polyline points="22 2 15 22 11 13 2 9 22 2" /></svg>;
  if (type === 'inbound') return <svg {...common}><polyline points="2 22 9 15 13 11 22 2" /><line x1="22" y1="2" x2="11" y2="13" /></svg>;
  return <svg {...common}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
}

function Thumbs({ list }: { list?: AttachItem[] }) {
  if (!list || !list.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
      {list.map((a, i) => (
        <a key={i} href={a.url} target="_blank" rel="noopener" title={a.name}>
          <img src={a.url} alt={a.name} style={{ height: 74, width: 74, objectFit: 'cover', borderRadius: 8, border: '1px solid #C8D4DF', display: 'block' }} />
        </a>
      ))}
    </div>
  );
}

/** Mirrors shared.js renderConversation. `maskStaff` (portal) hides the individual
 *  IT staff name on outbound/internal notes — the requester sees "HDS IT Helpdesk". */
export function Conversation({ notes, reqFirst, attMap = {}, maskStaff = false }: {
  notes: Note[]; reqFirst: string; attMap?: AttachMap; maskStaff?: boolean;
}) {
  if (!notes || !notes.length) {
    return <div style={{ color: '#9CA3AF', fontSize: 12, fontStyle: 'italic', marginBottom: 8 }}>No conversation yet.</div>;
  }
  const labelFor = (type: NoteType) =>
    type === 'outbound' ? `Sent to ${reqFirst}` : type === 'inbound' ? `Reply from ${reqFirst}` : 'Internal note';

  return (
    <>
      {notes.map((n) => {
        const s = NOTE_STYLE[n.note_type] || NOTE_STYLE.internal;
        const isStaff = n.note_type === 'outbound' || n.note_type === 'internal';
        const who = maskStaff && isStaff ? 'HDS IT Helpdesk' : n.added_by;
        return (
          <div key={n.id} className="note-item" style={{ background: s.bg, borderLeft: `3px solid ${s.border}`, padding: '10px 12px', borderRadius: 6, marginBottom: 8 }}>
            <div className="note-meta" style={{ color: s.color, fontWeight: 600 }}>
              <NoteIcon type={n.note_type} color={s.color} /> {labelFor(n.note_type)} ·{' '}
              <span style={{ color: '#6B7280', fontWeight: 500 }}>{who} · {fmtDate(n.created_at)}</span>
            </div>
            {n.note_text && <div className="note-text" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{n.note_text}</div>}
            <Thumbs list={attMap[n.id]} />
          </div>
        );
      })}
    </>
  );
}
