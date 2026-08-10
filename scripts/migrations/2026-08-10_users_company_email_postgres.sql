-- Add users.company_email (nullable, non-unique, not used for login).
-- Safe to re-run (idempotent).

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS company_email VARCHAR(100) NULL;

COMMIT;
