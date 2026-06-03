-- ═══════════════════════════════════════════════════════════════
-- HDS IT HELPDESK — v1.2.2 MIGRATION: 'waiting-on-admin' status
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- Adds one new status value so the ticket status doubles as a
-- "whose turn is it" flag. Auto-flip logic lives in the Netlify
-- functions (send-message.js / requester-reply.js), not here.
--
-- Purely additive — no existing values removed. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('open', 'in-progress', 'waiting-on-admin', 'waiting-on-requester', 'on-hold', 'resolved', 'closed'));

-- Verify (optional):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.tickets'::regclass and conname = 'tickets_status_check';
