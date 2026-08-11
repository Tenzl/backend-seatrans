-- Prefer 2026-08-11_drop_legacy_unused_tables.sql (same statements).
-- Kept so older docs/scripts that name this file still work.

DROP INDEX IF EXISTS idx_booking_partner_field_logs_partner_created;
DROP INDEX IF EXISTS idx_booking_partner_field_logs_actor_created;
DROP TABLE IF EXISTS booking_partner_field_change_logs;

DROP INDEX IF EXISTS idx_inquiry_field_change_logs_inquiry_id;
DROP INDEX IF EXISTS idx_inquiry_field_change_logs_changed_by;
DROP INDEX IF EXISTS idx_inquiry_change_logs_changed_by;
DROP INDEX IF EXISTS idx_inquiry_change_logs_inquiry;
DROP TABLE IF EXISTS inquiry_field_change_logs;

DROP TABLE IF EXISTS migrations;
