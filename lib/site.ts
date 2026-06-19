import type { NextRequest } from 'next/server';

/**
 * Site origin for server routes (magic-link redirects, portal links), derived
 * from the INCOMING REQUEST so links always point at the host the user is
 * actually on — preview or prod. (Netlify's DEPLOY_PRIME_URL/URL env vars are
 * unreliable at function runtime and resolved to prod, so we don't use them.)
 */
export function siteUrl(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  if (host) return `${proto}://${host}`;
  return 'https://it-helpdesk.hdsaus.com.au';
}
