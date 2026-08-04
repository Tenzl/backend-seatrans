-- Groups transport documents under one root Booking workflow.
-- Existing Booking records default to EXPORT to preserve the former
-- Booking -> BL behavior; legacy standalone documents stay ungrouped.

ALTER TABLE booking_document_records
  ADD COLUMN IF NOT EXISTS booking_flow VARCHAR(10),
  ADD COLUMN IF NOT EXISTS booking_id BIGINT;

UPDATE booking_document_records
SET booking_flow = 'EXPORT'
WHERE document_type = 'booking'
  AND booking_flow IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_booking_document_records_flow'
      AND conrelid = 'booking_document_records'::regclass
  ) THEN
    ALTER TABLE booking_document_records
      ADD CONSTRAINT ck_booking_document_records_flow
      CHECK (booking_flow IS NULL OR booking_flow IN ('IMPORT', 'EXPORT'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_booking_document_records_workflow_shape'
      AND conrelid = 'booking_document_records'::regclass
  ) THEN
    ALTER TABLE booking_document_records
      ADD CONSTRAINT ck_booking_document_records_workflow_shape
      CHECK (
        (
          document_type = 'booking'
          AND booking_flow IS NOT NULL
          AND booking_id IS NULL
        ) OR (
          document_type <> 'booking'
          AND booking_flow IS NULL
          AND (booking_id IS NULL OR booking_id <> id)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_booking_document_records_booking'
      AND conrelid = 'booking_document_records'::regclass
  ) THEN
    ALTER TABLE booking_document_records
      ADD CONSTRAINT fk_booking_document_records_booking
      FOREIGN KEY (booking_id)
      REFERENCES booking_document_records(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_booking_document_records_booking_id
  ON booking_document_records (booking_id, created_at ASC, id ASC)
  WHERE booking_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_document_records_active_step
  ON booking_document_records (booking_id, document_type)
  WHERE booking_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN booking_document_records.booking_flow IS
  'Root workflow direction: IMPORT or EXPORT; null on child documents.';
COMMENT ON COLUMN booking_document_records.booking_id IS
  'Self-reference to the root Booking record for AN / BL / D/O.';
