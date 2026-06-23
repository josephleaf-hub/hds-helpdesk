-- migration-v1.7-org-knowledge.sql
-- "House knowledge": HDS facts and conventions (email domains, naming, licences,
-- AD/OUs, how-we-do-things) that the AI features read so they use real values
-- and follow our conventions instead of leaving [bracket] gaps or guessing.
--
-- One row per labelled section (the section keys live in the app). NEW TABLE only.
-- Safe to run on production. Idempotent.

create table if not exists public.org_knowledge (
  section     text primary key,                 -- 'email' | 'naming' | 'licences' | 'accounts' | 'how'
  body        text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table public.org_knowledge enable row level security;

-- Read: any IT staff (admin or manager). Write: admins only (same as help_guides).
drop policy if exists "org_knowledge_staff_read" on public.org_knowledge;
create policy "org_knowledge_staff_read" on public.org_knowledge
  for select
  using (public.current_user_role() in ('admin', 'manager'));

drop policy if exists "org_knowledge_admin_write" on public.org_knowledge;
create policy "org_knowledge_admin_write" on public.org_knowledge
  for all
  using      (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- Reuse the help_guides_touch() trigger fn (sets updated_at on update).
drop trigger if exists org_knowledge_touch_trg on public.org_knowledge;
create trigger org_knowledge_touch_trg before update on public.org_knowledge
  for each row execute function public.help_guides_touch();
