-- ═══════════════════════════════════════════════════════════════
-- HDS IT HELPDESK — v1.1 MESSAGING MIGRATION
-- Run this in Supabase Dashboard → SQL Editor → New Query → Run
--
-- Adds:
--   1) note_type column on ticket_notes ('internal' | 'outbound' | 'inbound')
--      - internal  → existing notes, only visible to IT
--      - outbound  → message sent TO the requester, logged for record
--      - inbound   → reply FROM the requester, logged manually for now
--   2) new 'waiting-on-requester' ticket status
--      - used when IT has asked a question and the ball is in the requester's court
--
-- Safe to run on the live deployment — purely additive.
-- ═══════════════════════════════════════════════════════════════

-- 1) note_type column
ALTER TABLE public.ticket_notes
  ADD COLUMN IF NOT EXISTS note_type text NOT NULL DEFAULT 'internal'
  CHECK (note_type IN ('internal', 'outbound', 'inbound'));

CREATE INDEX IF NOT EXISTS ticket_notes_type_idx ON public.ticket_notes(note_type);

-- 2) waiting-on-requester status
-- Drop and recreate the check constraint to include the new value.
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('open', 'in-progress', 'waiting-on-requester', 'on-hold', 'resolved', 'closed'));

-- ═══════════════════════════════════════════════════════════════
-- Verify (optional — run separately to inspect):
--   select column_name, data_type from information_schema.columns
--   where table_name = 'ticket_notes';
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.tickets'::regclass and conname like '%status%';
-- ═══════════════════════════════════════════════════════════════
