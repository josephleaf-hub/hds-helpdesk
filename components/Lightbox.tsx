'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/* A simple image lightbox. useLightbox()(url, name) opens the image centered in
   an overlay (capped at 80vh, scaled to the image), instead of navigating to the
   raw file in a new tab. Esc or a click outside the image closes it. */
const LightboxCtx = createContext<(url: string, name?: string) => void>(() => {});

export function LightboxProvider({ children }: { children: React.ReactNode }) {
  const [img, setImg] = useState<{ url: string; name?: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const open = useCallback((url: string, name?: string) => { setLoaded(false); setImg({ url, name }); }, []);
  const close = useCallback(() => setImg(null), []);

  useEffect(() => {
    if (!img) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [img, close]);

  return (
    <LightboxCtx.Provider value={open}>
      {children}
      {img && (
        <div className="lightbox-overlay" onMouseDown={close}>
          <button className="lightbox-close" onClick={close} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          {!loaded && <div className="spinner lightbox-spinner" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="lightbox-img" src={img.url} alt={img.name || 'attachment'} onLoad={() => setLoaded(true)} onMouseDown={(e) => e.stopPropagation()} style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.25s' }} />
        </div>
      )}
    </LightboxCtx.Provider>
  );
}

export function useLightbox() {
  return useContext(LightboxCtx);
}
