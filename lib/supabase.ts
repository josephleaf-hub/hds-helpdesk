import { createClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client — same behaviour as the old `createHdsClient()`:
 * localStorage session, auto-refresh, and detectSessionInUrl (so magic-link
 * hash tokens are picked up on load). Client-components only.
 */
export const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

/**
 * A valid access token for API calls. Refreshes proactively if the current one
 * is within 2 minutes of expiry (or already expired), so server routes don't
 * reject it as "invalid or expired". Returns null only when truly signed out.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const expiresInMs = (session.expires_at ?? 0) * 1000 - Date.now();
  if (expiresInMs < 120_000) {
    const { data } = await sb.auth.refreshSession();
    return data.session?.access_token ?? null;
  }
  return session.access_token;
}
