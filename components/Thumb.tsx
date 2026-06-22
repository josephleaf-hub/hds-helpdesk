'use client';

import { useState } from 'react';
import { useLightbox } from '@/components/Lightbox';

/* A fixed-size thumbnail box that's always visible: shows a pulsing placeholder
   while the image loads, then fades the image in over it. Click opens the
   lightbox. Used for all attachment thumbnails (conversation + submitted photo). */
export function Thumb({ url, name, size = 74 }: { url: string; name?: string; size?: number }) {
  const lightbox = useLightbox();
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="thumb-box" style={{ width: size, height: size }} onClick={() => lightbox(url, name)} title={name}>
      {!loaded && <div className="thumb-box-load" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={name || 'attachment'} onLoad={() => setLoaded(true)} style={{ opacity: loaded ? 1 : 0 }} />
    </div>
  );
}
