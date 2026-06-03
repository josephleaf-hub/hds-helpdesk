-- ═══════════════════════════════════════════════════════════════
-- HDS IT HELPDESK — v1.2.3 MIGRATION: portable access tokens
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- One permanent, revocable token per requester email. Token URLs
-- (/p/{token}/...) replace one-time magic-link emails. The token table
-- is service-role-only — no public RLS policies; all access is via the
-- redeem-token / regenerate-token / submit-ticket / send-message
-- functions using the service_role key.
--
-- Additive — safe to re-run.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_access_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email    text NOT NULL UNIQUE,
  token         text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_user_access_tokens_email ON public.user_access_tokens (lower(user_email));
CREATE INDEX IF NOT EXISTS idx_user_access_tokens_token ON public.user_access_tokens (token) WHERE revoked_at IS NULL;

ALTER TABLE public.user_access_tokens ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: RLS enabled + no policy = deny all to anon/
-- authenticated. Only the service_role key (used by serverless functions)
-- can read/write this table.
