-- Drop generated voyage_number column from bill_of_lading_records.
-- Voyage is stored only inside payload.oceanVessel going forward.
-- Idempotent.

BEGIN;

DROP INDEX IF EXISTS idx_bill_of_lading_records_voyage_number;

ALTER TABLE bill_of_lading_records
  DROP COLUMN IF EXISTS voyage_number;

UPDATE bill_of_lading_records
SET payload =
  CASE
    WHEN COALESCE(NULLIF(TRIM(payload ->> 'voyageNumber'), ''), '') = '' THEN
      payload - 'voyageNumber'
    WHEN COALESCE(NULLIF(TRIM(payload ->> 'oceanVessel'), ''), '') = '' THEN
      (payload - 'voyageNumber')
        || jsonb_build_object('oceanVessel', TRIM(payload ->> 'voyageNumber'))
    WHEN STRPOS(
      LOWER(COALESCE(payload ->> 'oceanVessel', '')),
      LOWER(TRIM(payload ->> 'voyageNumber'))
    ) > 0 THEN
      payload - 'voyageNumber'
    ELSE
      (payload - 'voyageNumber')
        || jsonb_build_object(
          'oceanVessel',
          TRIM(payload ->> 'oceanVessel') || ' / ' || TRIM(payload ->> 'voyageNumber')
        )
  END
WHERE payload ? 'voyageNumber';

COMMIT;
