/* Port of netlify/functions/redeem-token.js — handles /p/{token}/...
   Looks up the permanent token, mints a fresh single-use Supabase magic link
   server-side, and 302-redirects to it. Invalid/revoked → /?signin=expired.
   Token never logged in full (last 4 only). */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { siteUrl } from '@/lib/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { slug?: string[] } }) {
  const SITE_URL = siteUrl(req);
  const fail = () => NextResponse.redirect(`${SITE_URL}/?signin=expired`, 302);

  const slug = params.slug || [];
  const token = slug[0] || '';
  const dest = slug.length > 1 ? '/' + slug.slice(1).join('/') : '/';
  if (!token) return fail();

  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // DB-level equality (never compare tokens in JS).
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

  const email = row.user_email as string;

  // The auth user must exist for a magiclink; create lazily (no-op if present).
  try { await admin.auth.admin.createUser({ email, email_confirm: true }); } catch { /* exists */ }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${SITE_URL}${dest}` },
  });
  const actionLink = linkData?.properties?.action_link;
  if (linkErr || !actionLink) {
    console.error('redeem-token: link generation failed:', linkErr?.message);
    return fail();
  }

  // Best-effort audit timestamp.
  await admin.from('user_access_tokens').update({ last_used_at: new Date().toISOString() }).eq('token', token);

  return NextResponse.redirect(actionLink, 302);
}
