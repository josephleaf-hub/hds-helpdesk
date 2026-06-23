/* Assignable IT staff for the ticket assign picker. Admin/manager only (Bearer
   JWT + user_roles). Returns admins + managers from user_roles by name. Uses the
   service role because user_roles RLS only lets a user read their OWN row, so a
   browser query can't list everyone. Read-only; no schema/RLS changes. */
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

  const { data: roleRow, error: roleErr } = await admin.from('user_roles').select('role').eq('user_id', userData.user.id).maybeSingle();
  if (roleErr) return NextResponse.json({ error: 'Role lookup failed: ' + roleErr.message }, { status: 500 });
  if (!roleRow || !['admin', 'manager'].includes(roleRow.role)) return NextResponse.json({ error: 'Account does not have IT staff access' }, { status: 403 });

  const { data, error } = await admin
    .from('user_roles')
    .select('user_id, full_name, role, department')
    .in('role', ['admin', 'manager'])
    .order('full_name', { ascending: true });
  if (error) return NextResponse.json({ error: 'Failed to load users: ' + error.message }, { status: 500 });

  const users = (data || []).map(u => ({
    user_id: String(u.user_id),
    full_name: String(u.full_name || ''),
    role: String(u.role),
    department: (u.department as string | null) ?? null,
  }));

  return NextResponse.json({ ok: true, users });
}
