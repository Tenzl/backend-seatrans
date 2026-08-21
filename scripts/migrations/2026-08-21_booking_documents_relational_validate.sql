-- Booking documents relational model: VALIDATE phase.
-- This phase is non-destructive: it validates expand-phase foreign keys,
-- enforces non-blank container rows, and aborts on control-total drift.

DO $migration$
DECLARE
  target RECORD;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('bill_of_lading_containers', 'ck_bl_containers_not_blank'),
    ('arrival_notice_containers', 'ck_an_containers_not_blank'),
    ('delivery_order_containers', 'ck_do_containers_not_blank')
  ) AS targets(table_name, constraint_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint constraint_record
        JOIN pg_class source_table ON source_table.oid = constraint_record.conrelid
        JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
       WHERE source_schema.nspname = 'public'
         AND source_table.relname = target.table_name
         AND constraint_record.conname = target.constraint_name
    ) THEN
      EXECUTE format($sql$
        ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
          NULLIF(BTRIM(container_type_code), '') IS NOT NULL OR
          NULLIF(BTRIM(container_no), '') IS NOT NULL OR
          NULLIF(BTRIM(seal_no), '') IS NOT NULL OR
          gross_weight_kg IS NOT NULL OR
          NULLIF(BTRIM(gross_weight_raw), '') IS NOT NULL OR
          measurement_cbm IS NOT NULL OR
          NULLIF(BTRIM(measurement_raw), '') IS NOT NULL OR
          tare_kg IS NOT NULL OR
          NULLIF(BTRIM(tare_raw), '') IS NOT NULL OR
          package_type_id IS NOT NULL OR
          NULLIF(BTRIM(package_type_snapshot), '') IS NOT NULL OR
          number_of_packages IS NOT NULL OR
          NULLIF(BTRIM(number_of_packages_raw), '') IS NOT NULL OR
          NULLIF(BTRIM(method), '') IS NOT NULL OR
          NULLIF(BTRIM(presentation_payload->>'note'), '') IS NOT NULL
        ) NOT VALID
      $sql$, target.table_name, target.constraint_name);
    END IF;
  END LOOP;

  FOR target IN
    SELECT source_schema.nspname AS schema_name,
           source_table.relname AS table_name,
           constraint_record.conname AS constraint_name
      FROM pg_constraint constraint_record
      JOIN pg_class source_table ON source_table.oid = constraint_record.conrelid
      JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
     WHERE source_schema.nspname = 'public'
       AND NOT constraint_record.convalidated
       AND (
         constraint_record.conname LIKE 'fk_booking_records_%' OR
         constraint_record.conname LIKE 'fk_bl_records_%' OR
         constraint_record.conname LIKE 'fk_an_records_%' OR
         constraint_record.conname LIKE 'fk_do_records_%' OR
         constraint_record.conname IN (
           'ck_bl_containers_not_blank',
           'ck_an_containers_not_blank',
           'ck_do_containers_not_blank'
         )
       )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I VALIDATE CONSTRAINT %I',
      target.schema_name,
      target.table_name,
      target.constraint_name
    );
  END LOOP;
END $migration$;

-- statement-break
DO $validation$
DECLARE
  relational_planned INTEGER;
  legacy_planned INTEGER;
  relational_bill_containers INTEGER;
  legacy_bill_containers INTEGER;
  mismatch_count INTEGER;
BEGIN
  SELECT COALESCE(SUM(quantity), 0)::integer
    INTO relational_planned
    FROM public.booking_cargo_volumes;

  SELECT COALESCE(SUM((volume.value #>> '{}')::integer), 0)::integer
    INTO legacy_planned
    FROM public.booking_records record
   CROSS JOIN LATERAL jsonb_each(
     CASE WHEN jsonb_typeof(record.payload->'cargoVolumes')='object'
          THEN record.payload->'cargoVolumes' ELSE '{}'::jsonb END
   ) volume
   WHERE BTRIM(volume.key) <> ''
     AND volume.value #>> '{}' ~ '^\d+$'
     AND (volume.value #>> '{}')::integer > 0;

  IF relational_planned <> legacy_planned THEN
    RAISE EXCEPTION 'Planned cargo quantity mismatch: relational %, legacy %',
      relational_planned, legacy_planned;
  END IF;

  SELECT COUNT(*)::integer
    INTO relational_bill_containers
    FROM public.bill_of_lading_containers;

  SELECT COUNT(*)::integer
    INTO legacy_bill_containers
    FROM public.bill_of_lading_records record
   CROSS JOIN LATERAL jsonb_array_elements(
     CASE WHEN jsonb_typeof(record.payload->'containers')='array'
          THEN record.payload->'containers' ELSE '[]'::jsonb END
   ) item(row)
   WHERE EXISTS (
     SELECT 1 FROM jsonb_each_text(item.row) field
      WHERE BTRIM(field.value) <> ''
   );

  IF relational_bill_containers <> legacy_bill_containers THEN
    RAISE EXCEPTION 'Bill container count mismatch: relational %, legacy %',
      relational_bill_containers, legacy_bill_containers;
  END IF;

  SELECT COUNT(*)::integer
    INTO mismatch_count
    FROM public.booking_records
   WHERE payload IS NULL
      OR document_number_v2 IS DISTINCT FROM NULLIF(BTRIM(payload->>'bookingNumber'), '');
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Booking relational projection has % mismatched rows', mismatch_count;
  END IF;

  SELECT COUNT(*)::integer
    INTO mismatch_count
    FROM public.bill_of_lading_records
   WHERE payload IS NULL
      OR document_number_v2 IS DISTINCT FROM NULLIF(BTRIM(payload->>'fblNumber'), '');
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Bill relational projection has % mismatched rows', mismatch_count;
  END IF;
END $validation$;
