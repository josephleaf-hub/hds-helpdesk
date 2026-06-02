-- ═══════════════════════════════════════════════════════════════
-- HDS IT HELPDESK — SUPABASE SCHEMA
-- Run this entire script in: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Extensions
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────
-- TICKET ID SEQUENCE (generates HDS-0001, HDS-0002 ...)
-- ─────────────────────────────────────────────
create sequence if not exists ticket_seq start 1;

create or replace function next_ticket_id() returns text
language plpgsql security definer as $$
begin
  return 'HDS-' || lpad(nextval('ticket_seq')::text, 4, '0');
end $$;

-- Allow all roles to call this function
grant execute on function next_ticket_id to anon, authenticated, service_role;

-- ─────────────────────────────────────────────
-- TICKETS TABLE
-- ─────────────────────────────────────────────
create table if not exists public.tickets (
  id              text primary key,
  category        text not null check (category in ('access', 'hardware', 'account', 'support')),
  sub_type        text not null,
  priority        text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  subject         text not null,
  description     text not null,
  requester_name  text not null,
  requester_email text not null,
  department      text not null,
  location        text,
  affected_user   text,
  status          text not null default 'open' check (status in ('open', 'in-progress', 'on-hold', 'resolved', 'closed')),
  assigned_to     text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  resolved_at     timestamptz
);

-- ─────────────────────────────────────────────
-- TICKET NOTES TABLE
-- ─────────────────────────────────────────────
create table if not exists public.ticket_notes (
  id          uuid default uuid_generate_v4() primary key,
  ticket_id   text not null references public.tickets(id) on delete cascade,
  added_by    text not null,
  note_text   text not null,
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────────
-- USER ROLES TABLE
-- Maps Supabase Auth users → roles (admin / manager)
-- ─────────────────────────────────────────────
create table if not exists public.user_roles (
  user_id     uuid not null references auth.users(id) on delete cascade primary key,
  role        text not null check (role in ('admin', 'manager')),
  department  text,      -- Set this for managers: e.g. 'Operations'
  full_name   text not null,
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────────
-- AUTO-UPDATE updated_at ON TICKET CHANGES
-- ─────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists tickets_updated_at on public.tickets;
create trigger tickets_updated_at
  before update on public.tickets
  for each row execute function update_updated_at();

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
alter table public.tickets      enable row level security;
alter table public.ticket_notes enable row level security;
alter table public.user_roles   enable row level security;

-- Helper functions (SECURITY DEFINER): read the caller's role/department
-- without triggering RLS on user_roles (avoids recursive policy evaluation).
-- Staff operations go via Netlify Functions on the service_role key, which
-- bypasses RLS — so staff submit/lookup is unaffected by the policies below.
create or replace function public.current_user_role()
  returns text language sql security definer stable set search_path = public
as $$ select role from public.user_roles where user_id = auth.uid(); $$;

create or replace function public.current_user_department()
  returns text language sql security definer stable set search_path = public
as $$ select department from public.user_roles where user_id = auth.uid(); $$;

create or replace function public.ticket_department(tid text)
  returns text language sql security definer stable set search_path = public
as $$ select department from public.tickets where id = tid; $$;

grant execute on function public.current_user_role()        to authenticated;
grant execute on function public.current_user_department()  to authenticated;
grant execute on function public.ticket_department(text)     to authenticated;

-- Tickets: admins see all; managers see only their own department.
-- (Multiple permissive policies are OR-combined by Postgres.)
drop policy if exists "tickets_admin_all"    on public.tickets;
create policy "tickets_admin_all" on public.tickets
  for all
  using      (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists "tickets_manager_dept" on public.tickets;
create policy "tickets_manager_dept" on public.tickets
  for all
  using      (public.current_user_role() = 'manager' and department = public.current_user_department())
  with check (public.current_user_role() = 'manager' and department = public.current_user_department());

-- Ticket notes: inherit the parent ticket's department scope.
drop policy if exists "notes_admin_all"    on public.ticket_notes;
create policy "notes_admin_all" on public.ticket_notes
  for all
  using      (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists "notes_manager_dept" on public.ticket_notes;
create policy "notes_manager_dept" on public.ticket_notes
  for all
  using      (public.current_user_role() = 'manager' and public.ticket_department(ticket_id) = public.current_user_department())
  with check (public.current_user_role() = 'manager' and public.ticket_department(ticket_id) = public.current_user_department());

-- User roles: users can read their own role only.
drop policy if exists "own_role_select" on public.user_roles;
create policy "own_role_select" on public.user_roles
  for select
  using (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- HOW TO ADD ADMIN / MANAGER USERS
-- ═══════════════════════════════════════════════════════════════
-- 1. Create the user in Supabase Dashboard → Authentication → Users
--    (use "Invite user" or "Add user" with their work email + password)
--
-- 2. Copy their User UID from the users list
--
-- 3. Run the appropriate INSERT below (replace the UUID and details):
--
-- For an IT Admin:
-- INSERT INTO public.user_roles (user_id, role, full_name)
-- VALUES ('paste-user-uuid-here', 'admin', 'Jane Smith');
--
-- For a Manager (scoped to one department):
-- INSERT INTO public.user_roles (user_id, role, department, full_name)
-- VALUES ('paste-user-uuid-here', 'manager', 'Operations', 'Tom Bailey');
--
-- Department must exactly match one of:
-- 'Operations', 'Technology', 'Finance', 'Sales', 'Customer Service',
-- 'HR & People', 'Leadership', 'Marketing', 'Warehouse', 'Driver / Field'
-- ═══════════════════════════════════════════════════════════════
