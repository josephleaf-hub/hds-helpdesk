'use client';

import { useEffect, useRef } from 'react';

export type MenuItem = { label: string; selected?: boolean; color?: string; onClick: () => void };

/* Mirrors the vanilla .pill-menu: a fixed-position dropdown anchored to a
   clicked element, closes on outside click / Escape. Used for the modal pills
   (status/priority/assignee) and the table row kebab (archive/restore). */
export function FloatingMenu({ rect, items, minWidth = 180, align = 'left', onClose, onHoverKeepOpen }: {
  rect: DOMRect;
  items: MenuItem[];
  minWidth?: number;
  align?: 'left' | 'right';
  onClose: () => void;
  onHoverKeepOpen?: { enter: () => void; leave: () => void };
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) &&
          !(e.target as HTMLElement).closest('.pill') && !(e.target as HTMLElement).closest('.kebab-btn')) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const t = setTimeout(() => document.addEventListener('click', onDoc), 0);
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const left = align === 'right' ? Math.max(8, rect.right - minWidth) : rect.left;
  return (
    <div ref={ref} className="pill-menu" style={{ top: rect.bottom + 6, left, minWidth }}
      onMouseEnter={onHoverKeepOpen?.enter} onMouseLeave={onHoverKeepOpen?.leave}>
      {items.map((it, i) => (
        <button key={i} className={it.selected ? 'selected' : ''} style={it.color ? { color: it.color } : undefined}
          onClick={it.onClick}>{it.label}</button>
      ))}
    </div>
  );
}
