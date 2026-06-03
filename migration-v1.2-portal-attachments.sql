-- ═══════════════════════════════════════════════════════════════
-- HDS IT HELPDESK — v1.2 MIGRATION: Staff Portal + Attachments
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- Adds:
--   1) ticket_attachments table + RLS
--   2) requester-facing READ RLS on tickets + ticket_notes
--   3) ticket-attachments storage bucket + storage RLS
--
-- Design decisions baked in (differ from the original spec draft):
--   • tickets.id and ticket_notes.ticket_id are TEXT ('HDS-0001'), not uuid.
--   • Uses the project's real helpers current_user_role() /
--     current_user_department() / ticket_department(text) — there is no
--     is_admin()/is_manager() in this codebase. They are SECURITY DEFINER
--     to avoid recursive RLS evaluation on user_roles.
--   • Requester policies are SELECT-ONLY. All requester writes (new ticket,
--     reply, mark-resolved, attachment) go through service-role Netlify
--     functions, which bypass RLS and ALSO guarantee the IT notification
--     fires. This removes the column-level exposure that a direct UPDATE/
--     INSERT policy would create (Postgres RLS cannot restrict columns).
--   • Internal notes (note_type='internal') are NEVER selectable by a
--     requester — enforced here in RLS as the backstop.
--
-- Idempotent: safe to re-run (drops each policy before recreating).
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1) ATTACHMENTS TABLE
-- ─────────────────────────────────────────────
create table if not exists public.ticket_attachments (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    text not null references public.tickets(id) on delete cascade,
  note_id      uuid references public.ticket_notes(id) on delete set null,
  storage_path text not null,
  file_name    text not null,
  file_size    int  not null,
  mime_type    text not null,
  uploaded_by  text not null,
  created_at   timestamptz not null default now()
);
create index if not exists ticket_attachments_ticket_idx on public.ticket_attachments(ticket_id);

alter table public.ticket_attachments enable row level security;

-- Admins: all. Managers: their department. Requesters: read their own.
drop policy if exists "atts_admin_all"        on public.ticket_attachments;
create policy "atts_admin_all" on public.ticket_attachments
  for all
  using      (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists "atts_manager_dept"     on public.ticket_attachments;
create policy "atts_manager_dept" on public.ticket_attachments
  for all
  using      (public.current_user_role() = 'manager' and public.ticket_department(ticket_id) = public.current_user_department())
  with check (public.current_user_role() = 'manager' and public.ticket_department(ticket_id) = public.current_user_department());

drop policy if exists "atts_requester_select" on public.ticket_attachments;
create policy "atts_requester_select" on public.ticket_attachments
  for select
  using (ticket_id in (select id from public.tickets where lower(requester_email) = lower(auth.email())));

-- ─────────────────────────────────────────────
-- 2) REQUESTER READ ACCESS ON EXISTING TABLES
--    (added alongside the existing admin/manager policies; Postgres
--     OR-combines multiple permissive policies.)
-- ─────────────────────────────────────────────
-- Requesters can read their own tickets.
drop policy if exists "tickets_requester_select" on public.tickets;
create policy "tickets_requester_select" on public.tickets
  for select
  using (lower(requester_email) = lower(auth.email()));

-- NOTE: deliberately NO requester UPDATE policy. "Mark as resolved" is
-- performed by requester-reply.js on the service role (status only).

-- Requesters read ONLY outbound + inbound notes on their own tickets.
-- Internal notes are never exposed.
drop policy if exists "notes_requester_select" on public.ticket_notes;
create policy "notes_requester_select" on public.ticket_notes
  for select
  using (
    note_type in ('outbound', 'inbound')
    and ticket_id in (select id from public.tickets where lower(requester_email) = lower(auth.email()))
  );

-- NOTE: deliberately NO requester INSERT policy. Replies go through
-- requester-reply.js (service role), which also emails IT.

-- ─────────────────────────────────────────────
-- 3) STORAGE BUCKET + RLS
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public)
  values ('ticket-attachments', 'ticket-attachments', false)
  on conflict (id) do nothing;

-- Path convention: {ticket_id}/{timestamp}-{sanitised-filename}
-- so (storage.foldername(name))[1] = the ticket id ('HDS-0023').
-- Uploads are performed by upload-attachment.js (service role); these
-- policies cover DIRECT reads (signed-URL generation by the browser).

drop policy if exists "storage_atts_admin_all"        on storage.objects;
create policy "storage_atts_admin_all" on storage.objects
  for all
  using      (bucket_id = 'ticket-attachments' and public.current_user_role() = 'admin')
  with check (bucket_id = 'ticket-attachments' and public.current_user_role() = 'admin');

drop policy if exists "storage_atts_manager_dept"     on storage.objects;
create policy "storage_atts_manager_dept" on storage.objects
  for select
  using (
    bucket_id = 'ticket-attachments'
    and public.current_user_role() = 'manager'
    and public.ticket_department((storage.foldername(name))[1]) = public.current_user_department()
  );

drop policy if exists "storage_atts_requester_select" on storage.objects;
create policy "storage_atts_requester_select" on storage.objects
  for select
  using (
    bucket_id = 'ticket-attachments'
    and (storage.foldername(name))[1] in (
      select id from public.tickets where lower(requester_email) = lower(auth.email())
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- POST-MIGRATION MANUAL STEPS (cannot be done from SQL):
--   1) Authentication → URL Configuration → Redirect URLs:
--        add   https://it-helpdesk.hdsaus.com.au/*
--   2) Authentication → Providers → Email: ensure Email (magic link) is on.
--
-- VERIFY (run separately):
--   -- requester A must NOT see requester B's ticket, nor any internal note.
--   select tablename, policyname, cmd from pg_policies
--   where schemaname in ('public','storage')
--     and (tablename = 'ticket_attachments'
--          or policyname like '%requester%' or policyname like '%atts%');
-- ═══════════════════════════════════════════════════════════════
