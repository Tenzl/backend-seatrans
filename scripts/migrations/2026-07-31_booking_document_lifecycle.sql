-- Booking document history lifecycle: draft/edit/complete/lock/archive.
-- Idempotent expand for existing booking_document_records rows.

ALTER TABLE booking_document_records
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED';

ALTER TABLE booking_document_records
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE booking_document_records
  ADD COLUMN IF NOT EXISTS updated_by_user_id INTEGER;

ALTER TABLE booking_document_records
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

ALTER TABLE booking_document_records
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE booking_document_records
  ADD COLUMN IF NOT EXISTS deleted_by_user_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'ck_booking_document_records_status'
  ) THEN
    ALTER TABLE booking_document_records
      ADD CONSTRAINT ck_booking_document_records_status
      CHECK (status IN ('PROCESSING', 'COMPLETED'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'fk_booking_document_records_updated_by'
  ) THEN
    ALTER TABLE booking_document_records
      ADD CONSTRAINT fk_booking_document_records_updated_by
      FOREIGN KEY (updated_by_user_id)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'fk_booking_document_records_deleted_by'
  ) THEN
    ALTER TABLE booking_document_records
      ADD CONSTRAINT fk_booking_document_records_deleted_by
      FOREIGN KEY (deleted_by_user_id)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_booking_document_records_active_created_at
  ON booking_document_records (created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_booking_document_records_type_active_created_at
  ON booking_document_records (document_type, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN booking_document_records.status IS
  'PROCESSING = draft/in progress; COMPLETED = Create & Preview finished.';
COMMENT ON COLUMN booking_document_records.locked_at IS
  'When set, edits are rejected. Unlock is not supported.';
COMMENT ON COLUMN booking_document_records.deleted_at IS
  'Soft-archive timestamp. Permanent delete removes the row.';
