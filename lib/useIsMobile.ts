'use client';

import { useEffect, useState } from 'react';

// True when the viewport is at/below maxWidth. Matches the breakpoint used for
// the sticky tab bar (900px). Safe on the client only (callers render client-side).
export function useIsMobile(maxWidth = 900): boolean {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= maxWidth);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [maxWidth]);
  return mobile;
}
