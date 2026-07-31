-- Forward-only users identity uniqueness hardening.
--
-- These indexes match the backend's canonical email/username comparison and
-- the external-provider identity pair. CONCURRENTLY keeps normal reads and
-- writes available and therefore each statement must run outside a transaction.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_users_email_normalized
  ON public.users ((LOWER(BTRIM(email))));

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_users_username_normalized_nonblank
  ON public.users ((LOWER(BTRIM(username))))
  WHERE username IS NOT NULL AND BTRIM(username) <> '';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_users_oauth_identity
  ON public.users (
    (LOWER(BTRIM(oauth_provider))),
    (BTRIM(oauth_provider_id))
  )
  WHERE oauth_provider IS NOT NULL
    AND BTRIM(oauth_provider) <> ''
    AND oauth_provider_id IS NOT NULL
    AND BTRIM(oauth_provider_id) <> '';
