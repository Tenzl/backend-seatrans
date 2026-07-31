-- Forward-only role-name uniqueness hardening.
--
-- LOWER(BTRIM(name)) matches the canonical comparison used by the backend.
-- CONCURRENTLY keeps reads and writes available while PostgreSQL builds and
-- validates the unique index. This statement must run outside a transaction.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_roles_name_normalized
  ON roles ((LOWER(BTRIM(name))));
