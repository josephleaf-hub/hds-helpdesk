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
