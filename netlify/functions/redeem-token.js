/* ═══════════════════════════════════════════════════════════════
   HDS IT HELPDESK — redeem-token function

   Handles /p/{token}/...  (Netlify rewrites /p/* here).
   Looks up the permanent token, mints a FRESH single-use Supabase
   magic link server-side, and 302-redirects the browser to it — so
   the session/RLS/30-day persistence all come from real Supabase auth,
   the user just never sees the "check your email" step.

   Invalid/revoked/garbage token → redirect to /?signin=expired (the
   portal shows the sign-in screen). No info leak, no raw 404.

   Token is never logged in full — last 4 chars only.
   ═══════════════════════════════════════════════════════════════ */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE_URL                  = 'https://it-helpdesk.hdsaus.com.au';

exports.handler = async (event) => {
  const fail = () => ({ statusCode: 302, headers: { Location: `${SITE_URL}/?signin=expired` }, body: '' });

  // Extract "{token}/rest..." from the path, tolerant of either the
  // public /p/ prefix or the rewritten function path.
  const path = event.path || '';
  let tail = '';
  if (path.includes('/p/')) tail = path.split('/p/')[1];
  else if (path.includes('/redeem-token/')) tail = path.split('/redeem-token/')[1];
  const parts = tail.split('/').filter(Boolean);
  const token = parts.shift() || '';
  const dest  = parts.length ? '/' + parts.join('/') : '/';

  if (!token) return fail();

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // DB-level equality (constant-time-ish; never compare tokens in JS).
  const { data: row, error } = await admin
    .from('user_access_tokens')
    .select('user_email')
    .eq('token', token)
    .is('revoked_at', null)
    .maybeSingle();

  if (error || !row) {
    console.warn('redeem-token: no active match for token …' + token.slice(-4));
    return fail();
  }

  const email = row.user_email;

  // The auth user must exist for a magiclink; create lazily (no-op if present).
  try { await admin.auth.admin.createUser({ email, email_confirm: true }); } catch (_) { /* exists */ }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${SITE_URL}${dest}` },
  });
  const actionLink = linkData && linkData.properties && linkData.properties.action_link;
  if (linkErr || !actionLink) {
    console.error('redeem-token: link generation failed:', linkErr && linkErr.message);
    return fail();
  }

  // Best-effort audit timestamp (ignore failures).
  await admin.from('user_access_tokens').update({ last_used_at: new Date().toISOString() }).eq('token', token);

  return { statusCode: 302, headers: { Location: actionLink }, body: '' };
};
