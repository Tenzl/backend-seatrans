-- Intentionally forward-only.
-- Removing imported Parties later could break Booking document references.
-- Restore only through a reviewed forward migration using the logical backup
-- produced by scripts/run-booking-agent-import.mjs.
DO $$
BEGIN
  RAISE EXCEPTION 'Forward-only migration: create a reviewed compensating migration instead';
END
$$;

