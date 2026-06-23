// Assignable IT staff (admins + managers) for the ticket assign picker.
// Fetched via the admin-only /api/assignable-users route (user_roles RLS blocks
// a browser from listing everyone).

import { getAccessToken } from '@/lib/supabase';

export interface AssignableUser {
  user_id: string;
  full_name: string;
  role: string;
  department: string | null;
}

export async function fetchAssignableUsers(): Promise<AssignableUser[]> {
  try {
    const token = await getAccessToken();
    if (!token) return [];
    const res = await fetch('/api/assignable-users', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return [];
    return Array.isArray(data.users) ? data.users : [];
  } catch {
    return [];
  }
}

// id -> full name, for displaying assigned_to (a user_id) as a name.
export function userNameMap(users: AssignableUser[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const u of users) m[u.user_id] = u.full_name;
  return m;
}
