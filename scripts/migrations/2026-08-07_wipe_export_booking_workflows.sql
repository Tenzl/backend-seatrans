-- Phase 0: hard-wipe all EXPORT booking workflows (booking + AN + BL + any DO).
-- IMPORT workflows are untouched.
--
-- Post table-split schema only (booking_records + child tables).
-- Child FKs use ON DELETE CASCADE, so deleting EXPORT booking_records removes
-- linked arrival_notice_records / bill_of_lading_records / delivery_order_records.
--
-- Idempotent: safe to re-run (no-op when no EXPORT rows remain).
--
-- Canonical docs mirror: docs/sql/2026-08-07_wipe_export_booking_workflows_postgres.sql
--
-- Apply before or with the Export Booking→BL (no AN) code deploy.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.booking_records') IS NULL THEN
    RAISE EXCEPTION
      'booking_records missing — apply table-split migration before this wipe';
  END IF;
END $$;

-- Explicit child deletes first (clear when CASCADE is absent on older DBs).
DELETE FROM bill_of_lading_records
WHERE booking_id IN (
  SELECT id FROM booking_records WHERE booking_flow = 'EXPORT'
);

DELETE FROM arrival_notice_records
WHERE booking_id IN (
  SELECT id FROM booking_records WHERE booking_flow = 'EXPORT'
);

DELETE FROM delivery_order_records
WHERE booking_id IN (
  SELECT id FROM booking_records WHERE booking_flow = 'EXPORT'
);

DELETE FROM booking_records
WHERE booking_flow = 'EXPORT';

COMMIT;
