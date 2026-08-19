-- Forward-only expand migration.
-- Keep the legacy code column, nonblank check and normalized unique index so
-- mixed application versions remain compatible during the transition.
ALTER TABLE public.commodity_types
  ALTER COLUMN code DROP NOT NULL;
