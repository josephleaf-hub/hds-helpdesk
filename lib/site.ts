/**
 * Canonical site origin for server routes (magic-link redirects, portal links).
 * On Netlify, DEPLOY_PRIME_URL is the branch/preview URL and URL is the prod
 * custom domain — so links are correct on both the preview and production.
 */
export function getSiteUrl(): string {
  return (
    process.env.DEPLOY_PRIME_URL ||
    process.env.URL ||
    'https://it-helpdesk.hdsaus.com.au'
  );
}
