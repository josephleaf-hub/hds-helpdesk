-- ═══════════════════════════════════════════════════════════════
-- HDS IT HELPDESK — RLS HARDENING MIGRATION
-- Enforces role + department scoping at the DATABASE level.
--
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- Safe to run on an existing v1 deployment: it DROPS the old
-- "everyone authenticated sees everything" policies and replaces
-- them with role-aware ones. Staff ticket submission is unaffected
-- (it goes through Netlify Functions on the service_role key, which
-- bypasses RLS entirely).
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- HELPER FUNCTIONS (SECURITY DEFINER)
-- Read the caller's role/department WITHOUT triggering RLS on
-- user_roles, which avoids recursive-policy evaluation.
-- ─────────────────────────────────────────────
create or replace function public.current_user_role()
  returns text
  language sql
  security definer
  stable
  set search_path = public
as $$
  select role from public.user_roles where user_id = auth.uid();
$$;

create or replace function public.current_user_department()
  returns text
  language sql
  security definer
  stable
  set search_path = public
as $$
  select department from public.user_roles where user_id = auth.uid();
$$;

-- Returns the department of a given ticket, bypassing RLS so the
-- ticket_notes policies can check scope without recursion.
create or replace function public.ticket_department(tid text)
  returns text
  language sql
  security definer
  stable
  set search_path = public
as $$
  select department from public.tickets where id = tid;
$$;

grant execute on function public.current_user_role()        to authenticated;
grant execute on function public.current_user_department()  to authenticated;
grant execute on function public.ticket_department(text)     to authenticated;

-- ─────────────────────────────────────────────
-- REMOVE THE OLD BLANKET POLICIES
-- ─────────────────────────────────────────────
drop policy if exists "authenticated_full_access"  on public.tickets;
drop policy if exists "authenticated_notes_access"  on public.ticket_notes;

-- ─────────────────────────────────────────────
-- TICKETS — role-aware access
-- Multiple permissive policies are OR-combined by Postgres, so an
-- admin matches the admin policy and a manager matches the manager
-- policy. Anyone with no row in user_roles matches neither → sees
-- nothing.
-- ─────────────────────────────────────────────
drop policy if exists "tickets_admin_all"      on public.tickets;
create policy "tickets_admin_all" on public.tickets
  for all
  using      (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists "tickets_manager_dept"   on public.tickets;
create policy "tickets_manager_dept" on public.tickets
  for all
  using (
    public.current_user_role() = 'manager'
    and department = public.current_user_department()
  )
  with check (
    public.current_user_role() = 'manager'
    and department = public.current_user_department()
  );

-- ─────────────────────────────────────────────
-- TICKET NOTES — inherit the parent ticket's scope
-- ─────────────────────────────────────────────
drop policy if exists "notes_admin_all"     on public.ticket_notes;
create policy "notes_admin_all" on public.ticket_notes
  for all
  using      (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists "notes_manager_dept"  on public.ticket_notes;
create policy "notes_manager_dept" on public.ticket_notes
  for all
  using (
    public.current_user_role() = 'manager'
    and public.ticket_department(ticket_id) = public.current_user_department()
  )
  with check (
    public.current_user_role() = 'manager'
    and public.ticket_department(ticket_id) = public.current_user_department()
  );

-- user_roles already has "own_role_select" from the base schema,
-- which lets the app read the signed-in user's own role. Left as-is.

-- ═══════════════════════════════════════════════════════════════
-- RESULT
--   • Admin     → all tickets + all notes (read & write)
--   • Manager   → ONLY their department's tickets + notes
--   • No role   → nothing
--   • Staff submit/lookup → unaffected (service_role bypasses RLS)
-- ═══════════════════════════════════════════════════════════════
