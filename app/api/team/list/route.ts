/* Team list for the "Team & access" page. Any IT admin (incl. Owners) may view;
   managers and non-staff are rejected. Merges user_roles with Supabase Auth data
   (service role) to derive each person's status and last-active. Read-only. */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return NextResponse.json({ error: 'Missing or malformed Authorization header' }, { status: 401 });
  const accessToken = authHeader.slice(7);

  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  const viewerId = userData.user.id;

  const { data: viewer, error: roleErr } = await admin.from('user_roles').select('role, is_owner').eq('user_id', viewerId).maybeSingle();
  if (roleErr) return NextResponse.json({ error: 'Role lookup failed: ' + roleErr.message }, { status: 500 });
  if (!viewer || viewer.role !== 'admin') return NextResponse.json({ error: 'Team management is admin-only' }, { status: 403 });

  const { data: roleRows, error: rErr } = await admin.from('user_roles').select('user_id, full_name, role, department, is_owner');
  if (rErr) return NextResponse.json({ error: 'Failed to load roles: ' + rErr.message }, { status: 500 });

  // Auth data → map by id (small team; one page is plenty).
  const authById: Record<string, { email: string; lastSignIn: string | null; confirmed: boolean; banned: boolean }> = {};
  try {
    const { data: au } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const now = Date.now();
    for (const u of au?.users || []) {
      const bannedUntil = (u as { banned_until?: string }).banned_until;
      authById[u.id] = {
        email: u.email || '',
        lastSignIn: u.last_sign_in_at ?? null,
        confirmed: !!(u.email_confirmed_at || (u as { confirmed_at?: string }).confirmed_at),
        banned: !!(bannedUntil && new Date(bannedUntil).getTime() > now),
      };
    }
  } catch (e) {
    console.error('team/list: listUsers failed', (e as Error).message);
  }

  const users = (roleRows || []).map(r => {
    const a = authById[r.user_id as string];
    const status = a?.banned ? 'deactivated' : (a && !a.confirmed ? 'invited' : 'active');
    return {
      user_id: String(r.user_id),
      full_name: String(r.full_name || ''),
      email: a?.email || '',
      role: r.is_owner ? 'owner' : String(r.role),
      department: (r.department as string | null) ?? null,
      is_owner: !!r.is_owner,
      status,
      last_active: a?.lastSignIn ?? null,
    };
  }).sort((x, y) => x.full_name.localeCompare(y.full_name));

  const ownerCount = users.filter(u => u.is_owner && u.status !== 'deactivated').length;

  return NextResponse.json({ ok: true, users, viewerId, viewerIsOwner: !!viewer.is_owner, ownerCount });
}
