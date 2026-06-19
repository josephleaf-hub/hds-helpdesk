'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type ConfirmOpts = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
};

const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);

/* Branded replacement for window.confirm(): returns a Promise<boolean>.
   Usage: const confirm = useConfirm(); if (await confirm({ title, body })) { … } */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => {
    resolver.current = resolve;
    setOpts(o);
  }), []);

  const settle = useCallback((v: boolean) => {
    setOpts(null);
    resolver.current?.(v);
    resolver.current = null;
  }, []);

  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false);
      if (e.key === 'Enter') settle(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [opts, settle]);

  const tone = opts?.tone || 'danger';

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {opts && (
        <div className="confirm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) settle(false); }}>
          <div className="confirm-card" role="alertdialog" aria-modal="true">
            <div className="confirm-title">{opts.title}</div>
            {opts.body && <div className="confirm-body">{opts.body}</div>}
            <div className="confirm-actions">
              <button className="btn-secondary" onClick={() => settle(false)}>{opts.cancelLabel || 'Cancel'}</button>
              <button className={tone === 'danger' ? 'btn-danger' : 'btn-primary'} onClick={() => settle(true)} autoFocus>
                {opts.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmCtx);
}
