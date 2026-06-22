-- migration-v1.5-realtime.sql
-- Enables Supabase Realtime for the in-page alerts feature (admin dashboard +
-- requester portal). Without this, the postgres_changes subscriptions in
-- components/RealtimeAlerts.tsx receive no events.
--
-- Realtime still respects RLS: each subscribing client only receives the rows
-- its policies allow (admins/managers hear all tickets/replies; a requester
-- only hears IT replies on their own tickets). No new policies are needed.
--
-- Safe to run on production. Idempotent: re-running a table that's already in
-- the publication is a harmless no-op error, so each ADD is guarded with a
-- DO block that checks membership first.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'tickets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ticket_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_notes;
  END IF;
END $$;

-- Verify (optional): should list both tables.
-- SELECT schemaname, tablename FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
-- ORDER BY tablename;
