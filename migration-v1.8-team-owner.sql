-- migration-v1.8-team-owner.sql
-- "Team & access": adds the Owner capability (user management) as an ADDITIVE
-- boolean on user_roles. Owners are admins (every existing 'admin' check is
-- untouched) PLUS the ability to invite/change-role/deactivate users.
--
-- Status (Active / Invited / Deactivated) is DERIVED server-side from Supabase
-- Auth (email confirmation, last sign-in, banned_until) — no extra column.
-- Safe to run on production. Idempotent.

alter table public.user_roles
  add column if not exists is_owner boolean not null default false;

-- Owner check for any future SECURITY DEFINER / RLS use (mirrors current_user_role).
create or replace function public.current_user_is_owner()
  returns boolean language sql security definer stable set search_path = public
as $$ select coalesce((select is_owner from public.user_roles where user_id = auth.uid()), false); $$;
grant execute on function public.current_user_is_owner() to authenticated;

-- Seed the sole Owner. Adjust the email if Joseph's login differs.
update public.user_roles set is_owner = true
  where user_id = (select id from auth.users where lower(email) = lower('joseph.leaf@hdsau.com'));
