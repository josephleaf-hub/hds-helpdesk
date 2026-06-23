/* Export the admin ticket view to CSV. Admin/manager only (managers scoped to
   their department). Re-runs the ticket query server-side with the SAME filters
   the admin table uses, so the file contains ALL matching rows. Structured
   columns only — no conversation/notes, no attachments. ZERO schema changes. */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Ticket } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Filters = {
  search?: string;
  status?: string;
  category?: string;
  priority?: string;
  assignee?: string;        // '' | '__unassigned__' | a name
  showArchived?: boolean;
  createdFrom?: string;     // optional ISO date range (not in the UI today, honoured if sent)
  createdTo?: string;
};

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return NextResponse.json({ error: 'Missing or malformed Authorization header' }, { status: 401 });
  const accessToken = authHeader.slice(7);

  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const { data: roleRow, error: roleErr } = await admin.from('user_roles').select('role, department').eq('user_id', userData.user.id).maybeSingle();
  if (roleErr) return NextResponse.json({ error: 'Role lookup failed: ' + roleErr.message }, { status: 500 });
  if (!roleRow || !['admin', 'manager'].includes(roleRow.role)) return NextResponse.json({ error: 'Account does not have IT staff access' }, { status: 403 });

  let f: Filters;
  try { f = (await req.json()) as Filters; } catch { f = {}; }

  // Structured filters in the query; manager dept scope enforced server-side
  // (mirrors loadTickets + the client `filtered` memo in app/admin/page.tsx).
  let q = admin.from('tickets').select('*').order('created_at', { ascending: false });
  if (roleRow.role === 'manager' && roleRow.department) q = q.eq('department', roleRow.department);
  if (!f.showArchived) q = q.is('deleted_at', null);
  if (f.status) q = q.eq('status', f.status);
  if (f.category) q = q.eq('category', f.category);
  if (f.priority) q = q.eq('priority', f.priority);
  if (f.assignee === '__unassigned__') q = q.is('assigned_to', null);
  else if (f.assignee) q = q.eq('assigned_to', f.assignee);
  if (f.createdFrom) q = q.gte('created_at', f.createdFrom);
  if (f.createdTo) q = q.lte('created_at', f.createdTo);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: 'Query failed: ' + error.message }, { status: 500 });

  // Search matches across the same fields as the table's client-side filter.
  let rows = (data as Ticket[]) || [];
  const s = (f.search || '').toLowerCase().trim();
  if (s) rows = rows.filter(t => `${t.id} ${t.subject} ${t.requester_name} ${t.department} ${t.sub_type}`.toLowerCase().includes(s));

  if (!rows.length) return NextResponse.json({ empty: true, message: 'No tickets match the current filters' }, { status: 200 });

  // assigned_to holds a user_id; map to a name for the export (fall back to the
  // raw value for any legacy label-based assignment).
  const { data: roleRows } = await admin.from('user_roles').select('user_id, full_name');
  const nameById: Record<string, string> = {};
  for (const r of roleRows || []) nameById[String(r.user_id)] = String(r.full_name || '');
  const assignedName = (id: string | null) => id ? (nameById[id] || id) : '';

  const HEADERS = ['Ref', 'Subject', 'Category', 'Sub-type', 'Priority', 'Status', 'Requester name', 'Requester email', 'Department', 'Location', 'Affected user', 'Assigned to', 'Created', 'Resolved', 'Time to resolve (hours)'];
  const lines = [HEADERS.map(csvCell).join(',')];
  for (const t of rows) {
    lines.push([
      t.id, t.subject, t.category, t.sub_type, t.priority, t.status,
      t.requester_name, t.requester_email, t.department, t.location ?? '', t.affected_user ?? '',
      assignedName(t.assigned_to), fmtDateTime(t.created_at), fmtDateTime(t.resolved_at),
      hoursToResolve(t.created_at, t.resolved_at),
    ].map(csvCell).join(','));
  }
  // BOM so Excel reads UTF-8 (accented characters) correctly.
  const csv = '﻿' + lines.join('\r\n');

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="hds-tickets-${fileDate()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

// Wrap in double quotes if the value has a comma, quote, or newline; double up
// any internal quotes. Everything else passes through verbatim.
function csvCell(v: unknown): string {
  const str = v == null ? '' : String(v);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// Readable AU date-time, pinned to Australian Eastern so exports are consistent
// regardless of server timezone. Blank for null (e.g. unresolved tickets).
function fmtDateTime(s?: string | null): string {
  if (!s) return '';
  return new Date(s).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney' });
}

// Decimal hours from created → resolved, 1 dp. Blank if not yet resolved.
function hoursToResolve(created?: string | null, resolved?: string | null): string {
  if (!created || !resolved) return '';
  const ms = new Date(resolved).getTime() - new Date(created).getTime();
  if (isNaN(ms) || ms < 0) return '';
  return (Math.round(ms / 360000) / 10).toFixed(1);
}

function fileDate(): string {
  // YYYY-MM-DD in AU Eastern.
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Australia/Sydney' }).format(new Date());
  return parts; // en-CA gives YYYY-MM-DD
}
