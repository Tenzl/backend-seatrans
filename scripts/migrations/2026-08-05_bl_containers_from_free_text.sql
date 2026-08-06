-- Seed BL `containers` from legacy free-text cargo columns when missing.
-- App code also normalizes on read/write; this is an optional one-time backfill.
-- Prefer the Node runner (mirrors app helpers):
--   node scripts/migrate-bl-containers-from-free-text.mjs

UPDATE bill_of_lading_records
SET payload = jsonb_set(
  payload,
  '{containers}',
  jsonb_build_array(
    jsonb_build_object(
      'type', '',
      'containerNo', '',
      'sealNo', '',
      'grossWeight', COALESCE(payload->>'grossWeight', ''),
      'measurement', COALESCE(payload->>'measurement', ''),
      'tare', '',
      'packageType',
        CASE
          WHEN position(' ' in btrim(COALESCE(payload->>'numberAndKindOfPackages', ''))) > 0
            THEN btrim(
              substring(
                btrim(payload->>'numberAndKindOfPackages')
                from position(' ' in btrim(payload->>'numberAndKindOfPackages')) + 1
              )
            )
          ELSE ''
        END,
      'noOfPkgs',
        CASE
          WHEN COALESCE(btrim(payload->>'numberAndKindOfPackages'), '') = '' THEN ''
          ELSE split_part(btrim(payload->>'numberAndKindOfPackages'), ' ', 1)
        END,
      'note', COALESCE(payload->>'descriptionOfGoods', ''),
      'method', ''
    )
  ),
  true
)
WHERE deleted_at IS NULL
  AND (
    NOT (payload ? 'containers')
    OR jsonb_typeof(payload->'containers') <> 'array'
    OR jsonb_array_length(payload->'containers') = 0
  )
  AND (
    COALESCE(btrim(payload->>'descriptionOfGoods'), '') <> ''
    OR COALESCE(btrim(payload->>'grossWeight'), '') <> ''
    OR COALESCE(btrim(payload->>'measurement'), '') <> ''
    OR COALESCE(btrim(payload->>'numberAndKindOfPackages'), '') <> ''
  );
