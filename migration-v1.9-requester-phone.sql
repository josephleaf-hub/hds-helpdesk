-- migration-v1.9-requester-phone.sql
-- Optional contact mobile number for a ticket's requester, so the IT team can
-- call them. Additive, nullable column. Safe to run on production. Idempotent.

alter table public.tickets
  add column if not exists requester_phone text;
