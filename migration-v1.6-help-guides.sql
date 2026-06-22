-- migration-v1.6-help-guides.sql
-- Help guides: an editable knowledge bank that surfaces clarifying questions +
-- resolution steps for a ticket's category/sub_type in the admin modal rail.
--
-- NEW TABLE ONLY. No changes to tickets / ticket_notes / user_roles or their RLS.
-- Safe to run on production. Idempotent (IF NOT EXISTS / drop-and-recreate policy).

create table if not exists public.help_guides (
  id          uuid primary key default gen_random_uuid(),
  category    text not null,                 -- matches tickets.category
  sub_type    text,                          -- matches tickets.sub_type; NULL = category-wide guide
  title       text not null,
  questions   jsonb not null default '[]'::jsonb,  -- ordered array of clarifying-question strings
  steps       jsonb not null default '[]'::jsonb,  -- ordered array of resolution-step strings
  usage_count integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- Matching key: prefer an exact category+sub_type guide, else fall back to the
-- category-wide (sub_type IS NULL) guide. Index covers both lookups.
create index if not exists help_guides_match_idx on public.help_guides (category, sub_type);

alter table public.help_guides enable row level security;

-- Read: any IT staff (admin or manager). Write: admins only — editing the bank is
-- an admin action. (Usage counting goes through the SECURITY DEFINER fn below so
-- managers can still bump the counter when a guide is surfaced for them.)
drop policy if exists "help_guides_staff_read" on public.help_guides;
create policy "help_guides_staff_read" on public.help_guides
  for select
  using (public.current_user_role() in ('admin', 'manager'));

drop policy if exists "help_guides_admin_write" on public.help_guides;
create policy "help_guides_admin_write" on public.help_guides
  for all
  using      (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- Increment usage when a guide is surfaced for a ticket. SECURITY DEFINER so a
-- manager (read-only on the table) can still count usage; guarded to staff only.
create or replace function public.increment_guide_usage(gid uuid)
  returns void language plpgsql security definer set search_path = public
as $$
begin
  if public.current_user_role() not in ('admin', 'manager') then
    raise exception 'not authorised';
  end if;
  update public.help_guides set usage_count = usage_count + 1 where id = gid;
end;
$$;

grant execute on function public.increment_guide_usage(uuid) to authenticated;

-- Keep updated_at fresh on every write.
create or replace function public.help_guides_touch()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists help_guides_touch_trg on public.help_guides;
create trigger help_guides_touch_trg before update on public.help_guides
  for each row execute function public.help_guides_touch();
