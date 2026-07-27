'use client';

import React from 'react';

// Split on http(s) URLs, keeping the URLs (capturing group → odd indices).
const URL_RE = /(https?:\/\/[^\s]+)/g;

// Pull trailing sentence punctuation back out of a URL so "see (https://x.com)."
// links only the URL, not the ")." after it.
function splitTrailing(url: string): [string, string] {
  const m = url.match(/[.,!?)\]}]+$/);
  return m ? [url.slice(0, -m[0].length), m[0]] : [url, ''];
}

// Renders plain text with any http(s) URL turned into a link that opens in a new
// tab. React escapes the text nodes, so this is safe for user-provided content.
export function Linkify({ text }: { text: string }) {
  const parts = String(text || '').split(URL_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part; // plain-text segments
        const [href, trail] = splitTrailing(part);
        return (
          <React.Fragment key={i}>
            <a href={href} target="_blank" rel="noopener noreferrer">{href}</a>{trail}
          </React.Fragment>
        );
      })}
    </>
  );
}
