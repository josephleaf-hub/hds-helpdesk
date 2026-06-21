-- ═══════════════════════════════════════════════════════════════
-- HDS IT Helpdesk — migration v1.4: rename "open" status to "new"
--
-- The "open" status was doing two jobs — "exists and isn't closed" AND
-- "untriaged/just landed". "new" is honest: the ticket just arrived and
-- IT hasn't touched it yet. It leaves this state on the first IT action,
-- exactly as "open" did. No new states, no logic changes — a pure rename
-- of one status value.
--
-- Safe to run on production. Idempotent: the UPDATE is a no-op once no
-- 'open' rows remain, and the constraint is dropped IF EXISTS before
-- being recreated.
--
-- IMPORTANT — ordering: the new CHECK constraint only allows 'new', not
-- 'open'. Run this TOGETHER WITH the matching code deploy (which creates
-- tickets as 'new'). If the constraint flips while old code is still live,
-- inserts of 'open' tickets would be rejected until the new code ships.
-- ═══════════════════════════════════════════════════════════════

-- 1. Rename existing data.
UPDATE public.tickets SET status = 'new' WHERE status = 'open';

-- 2. Swap the CHECK constraint (Postgres has no ALTER CONSTRAINT for CHECK).
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('new', 'in-progress', 'waiting-on-admin',
                    'waiting-on-requester', 'on-hold', 'resolved', 'closed'));

-- 3. Update the column default for any future inserts that omit status.
ALTER TABLE public.tickets ALTER COLUMN status SET DEFAULT 'new';
