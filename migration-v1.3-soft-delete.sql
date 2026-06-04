-- ═══════════════════════════════════════════════════════════════
-- HDS IT Helpdesk — migration v1.3: soft-delete (archive) tickets
--
-- Adds a `deleted_at` timestamp to tickets. A non-null value means the
-- ticket is archived: hidden from the admin list + KPIs, but the row,
-- its notes, and its attachments are all KEPT on record (recoverable).
--
-- This is a SOFT delete on purpose — tickets are an audit record. Nothing
-- here destroys data. Admins archive/restore from the dashboard UI by
-- setting/clearing deleted_at, which their existing UPDATE RLS allows.
--
-- Safe to run on production. Idempotent (IF NOT EXISTS).
-- Run in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Partial index: the common query is "active tickets" (deleted_at IS NULL).
CREATE INDEX IF NOT EXISTS tickets_active_idx
  ON public.tickets (created_at DESC)
  WHERE deleted_at IS NULL;

-- Verify:
--   select id, status, deleted_at from public.tickets order by created_at desc;
