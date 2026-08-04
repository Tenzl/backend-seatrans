-- SCHEMA-ONLY ROLLBACK FOR 2026-08-04_split_booking_document_records.sql.
--
-- DATA IS IRREVERSIBLE: the 14 deleted legacy rows cannot be reconstructed.
-- This rollback is intentionally permitted only while all four replacement
-- tables are empty. Run it manually in a transaction during maintenance.

DO $$
DECLARE
  split_row_count BIGINT;
BEGIN
  IF to_regclass('public.booking_document_records') IS NOT NULL THEN
    RAISE EXCEPTION 'booking_document_records already exists';
  END IF;
  IF to_regclass('public.booking_records') IS NULL
    OR to_regclass('public.arrival_notice_records') IS NULL
    OR to_regclass('public.delivery_order_records') IS NULL
    OR to_regclass('public.bill_of_lading_records') IS NULL THEN
    RAISE EXCEPTION 'all four split tables must exist before schema rollback';
  END IF;

  SELECT
    (SELECT COUNT(*) FROM booking_records)
    + (SELECT COUNT(*) FROM arrival_notice_records)
    + (SELECT COUNT(*) FROM delivery_order_records)
    + (SELECT COUNT(*) FROM bill_of_lading_records)
  INTO split_row_count;

  IF split_row_count <> 0 THEN
    RAISE EXCEPTION
      'schema rollback only supports empty split tables; found % rows',
      split_row_count;
  END IF;
END $$;

-- Deliberately omit CASCADE so unexpected dependencies stop the rollback.
DROP TABLE bill_of_lading_records;
DROP TABLE delivery_order_records;
DROP TABLE arrival_notice_records;
DROP TABLE booking_records;

CREATE TABLE booking_document_records (
  id BIGSERIAL PRIMARY KEY,
  document_type VARCHAR(20) NOT NULL,
  booking_flow VARCHAR(10),
  booking_id BIGINT,
  reference_number VARCHAR(200),
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
  created_by_user_id INTEGER NOT NULL,
  updated_by_user_id INTEGER,
  deleted_by_user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT ck_booking_document_records_type
    CHECK (document_type IN ('an', 'booking', 'do', 'bl')),
  CONSTRAINT ck_booking_document_records_flow
    CHECK (booking_flow IS NULL OR booking_flow IN ('IMPORT', 'EXPORT')),
  CONSTRAINT ck_booking_document_records_status
    CHECK (status IN ('PROCESSING', 'COMPLETED')),
  CONSTRAINT ck_booking_document_records_workflow_shape
    CHECK (
      (document_type = 'booking' AND booking_flow IS NOT NULL AND booking_id IS NULL)
      OR
      (document_type <> 'booking' AND booking_flow IS NULL)
    ),
  CONSTRAINT fk_booking_document_records_booking
    FOREIGN KEY (booking_id) REFERENCES booking_document_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_document_records_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_booking_document_records_updated_by
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_booking_document_records_deleted_by
    FOREIGN KEY (deleted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_booking_document_records_active_created_at
  ON booking_document_records (created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_booking_document_records_type_active_created_at
  ON booking_document_records (document_type, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_booking_document_records_booking_id
  ON booking_document_records (booking_id, created_at ASC, id ASC)
  WHERE booking_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_booking_document_records_active_step
  ON booking_document_records (booking_id, document_type)
  WHERE booking_id IS NOT NULL AND deleted_at IS NULL;
