-- Drop unused legacy tables. Safe to re-run.
-- KEEP: inquiry_idempotency_keys, shipping_agency_field_change_logs,
--        app_schema_migrations, app_data_migrations.
--
-- 1) booking_partner_field_change_logs — feature removed from app
-- 2) inquiry_field_change_logs — superseded by shipping_agency_field_change_logs
-- 3) migrations — leftover tracker; app uses app_schema_migrations / app_data_migrations

DROP INDEX IF EXISTS idx_booking_partner_field_logs_partner_created;
DROP INDEX IF EXISTS idx_booking_partner_field_logs_actor_created;
DROP TABLE IF EXISTS booking_partner_field_change_logs;

DROP INDEX IF EXISTS idx_inquiry_field_change_logs_inquiry_id;
DROP INDEX IF EXISTS idx_inquiry_field_change_logs_changed_by;
DROP INDEX IF EXISTS idx_inquiry_change_logs_changed_by;
DROP INDEX IF EXISTS idx_inquiry_change_logs_inquiry;
DROP TABLE IF EXISTS inquiry_field_change_logs;

DROP TABLE IF EXISTS migrations;
