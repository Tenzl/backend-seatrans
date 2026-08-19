DO $$
DECLARE
  freight_forwarding_count integer;
BEGIN
  SELECT count(*)::integer
    INTO freight_forwarding_count
    FROM public.service_types service_type
   WHERE upper(regexp_replace(btrim(coalesce(service_type.name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
      OR upper(regexp_replace(btrim(coalesce(service_type.display_name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING';

  IF freight_forwarding_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Freight Forwarding Service, found %', freight_forwarding_count;
  END IF;
END
$$;

WITH freight_forwarding AS (
  SELECT service_type.id
    FROM public.service_types service_type
   WHERE upper(regexp_replace(btrim(coalesce(service_type.name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
      OR upper(regexp_replace(btrim(coalesce(service_type.display_name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
), normalized_package_types AS (
  SELECT DISTINCT ON (lower(regexp_replace(btrim(package_type.display_name), '[[:space:]]+', ' ', 'g')))
         regexp_replace(btrim(package_type.display_name), '[[:space:]]+', ' ', 'g') AS name,
         lower(regexp_replace(btrim(package_type.display_name), '[[:space:]]+', ' ', 'g')) AS normalized_name,
         package_type.id
    FROM public.package_types package_type
   WHERE btrim(package_type.display_name) <> ''
   ORDER BY
         lower(regexp_replace(btrim(package_type.display_name), '[[:space:]]+', ' ', 'g')),
         package_type.id
)
INSERT INTO public.commodity_types (
  service_type_id,
  name,
  created_at,
  updated_at
)
SELECT freight_forwarding.id,
       source.name,
       now(),
       now()
  FROM freight_forwarding
 CROSS JOIN normalized_package_types source
 WHERE NOT EXISTS (
   SELECT 1
     FROM public.commodity_types existing
    WHERE existing.service_type_id = freight_forwarding.id
      AND lower(regexp_replace(btrim(existing.name), '[[:space:]]+', ' ', 'g')) = source.normalized_name
 );

-- Remove the pre-existing Freight Forwarding Type named PALLETS. Existing
-- Booking snapshots are detached from that catalog ID while cargoVolumes stay
-- unchanged and the human-readable commodity is preserved.
WITH freight_forwarding AS (
  SELECT service_type.id
    FROM public.service_types service_type
   WHERE upper(regexp_replace(btrim(coalesce(service_type.name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
      OR upper(regexp_replace(btrim(coalesce(service_type.display_name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
), legacy_pallets AS (
  SELECT type.id
    FROM public.commodity_types type
    JOIN freight_forwarding service_type ON service_type.id = type.service_type_id
   WHERE lower(regexp_replace(btrim(type.name), '[[:space:]]+', ' ', 'g')) = 'pallets'
)
UPDATE public.booking_records record
   SET payload = jsonb_set(
     jsonb_set(
       jsonb_set(record.payload, '{commodityTypeId}', 'null'::jsonb, true),
       '{commodityType}',
       to_jsonb(''::text),
       true
     ),
     '{commodity}',
     to_jsonb(
       coalesce(
         nullif(btrim(record.payload ->> 'commodityName'), ''),
         btrim(regexp_replace(coalesce(record.payload ->> 'commodity', ''), '[[:space:]]+IN[[:space:]]+PALLETS[[:space:]]*$', '', 'i'))
       )
     ),
     true
   )
 WHERE (record.payload ->> 'commodityTypeId') ~ '^[0-9]+$'
   AND (record.payload ->> 'commodityTypeId')::integer IN (
     SELECT id FROM legacy_pallets
   )
    OR lower(regexp_replace(btrim(coalesce(record.payload ->> 'commodityType', '')), '[[:space:]]+', ' ', 'g')) = 'pallets';

WITH freight_forwarding AS (
  SELECT service_type.id
    FROM public.service_types service_type
   WHERE upper(regexp_replace(btrim(coalesce(service_type.name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
      OR upper(regexp_replace(btrim(coalesce(service_type.display_name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
), legacy_pallets AS (
  SELECT type.id
    FROM public.commodity_types type
    JOIN freight_forwarding service_type ON service_type.id = type.service_type_id
   WHERE lower(regexp_replace(btrim(type.name), '[[:space:]]+', ' ', 'g')) = 'pallets'
)
UPDATE public.arrival_notice_records record
   SET payload = jsonb_set(
     jsonb_set(record.payload, '{commodityTypeId}', 'null'::jsonb, true),
     '{commodityType}',
     to_jsonb(''::text),
     true
   )
 WHERE (record.payload ->> 'commodityTypeId') ~ '^[0-9]+$'
   AND (record.payload ->> 'commodityTypeId')::integer IN (
     SELECT id FROM legacy_pallets
   )
    OR lower(regexp_replace(btrim(coalesce(record.payload ->> 'commodityType', '')), '[[:space:]]+', ' ', 'g')) = 'pallets';

WITH freight_forwarding AS (
  SELECT service_type.id
    FROM public.service_types service_type
   WHERE upper(regexp_replace(btrim(coalesce(service_type.name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
      OR upper(regexp_replace(btrim(coalesce(service_type.display_name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
), legacy_pallets AS (
  SELECT type.id
    FROM public.commodity_types type
    JOIN freight_forwarding service_type ON service_type.id = type.service_type_id
   WHERE lower(regexp_replace(btrim(type.name), '[[:space:]]+', ' ', 'g')) = 'pallets'
)
UPDATE public.delivery_order_records record
   SET payload = jsonb_set(
     jsonb_set(record.payload, '{commodityTypeId}', 'null'::jsonb, true),
     '{commodityType}',
     to_jsonb(''::text),
     true
   )
 WHERE (record.payload ->> 'commodityTypeId') ~ '^[0-9]+$'
   AND (record.payload ->> 'commodityTypeId')::integer IN (
     SELECT id FROM legacy_pallets
   )
    OR lower(regexp_replace(btrim(coalesce(record.payload ->> 'commodityType', '')), '[[:space:]]+', ' ', 'g')) = 'pallets';

WITH freight_forwarding AS (
  SELECT service_type.id
    FROM public.service_types service_type
   WHERE upper(regexp_replace(btrim(coalesce(service_type.name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
      OR upper(regexp_replace(btrim(coalesce(service_type.display_name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
), legacy_pallets AS (
  SELECT type.id
    FROM public.commodity_types type
    JOIN freight_forwarding service_type ON service_type.id = type.service_type_id
   WHERE lower(regexp_replace(btrim(type.name), '[[:space:]]+', ' ', 'g')) = 'pallets'
)
UPDATE public.bill_of_lading_records record
   SET payload = jsonb_set(
     jsonb_set(record.payload, '{commodityTypeId}', 'null'::jsonb, true),
     '{commodityType}',
     to_jsonb(''::text),
     true
   )
 WHERE (record.payload ->> 'commodityTypeId') ~ '^[0-9]+$'
   AND (record.payload ->> 'commodityTypeId')::integer IN (
     SELECT id FROM legacy_pallets
   )
    OR lower(regexp_replace(btrim(coalesce(record.payload ->> 'commodityType', '')), '[[:space:]]+', ' ', 'g')) = 'pallets';

WITH freight_forwarding AS (
  SELECT service_type.id
    FROM public.service_types service_type
   WHERE upper(regexp_replace(btrim(coalesce(service_type.name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
      OR upper(regexp_replace(btrim(coalesce(service_type.display_name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
), legacy_pallets AS (
  SELECT type.id
    FROM public.commodity_types type
    JOIN freight_forwarding service_type ON service_type.id = type.service_type_id
   WHERE lower(regexp_replace(btrim(type.name), '[[:space:]]+', ' ', 'g')) = 'pallets'
)
UPDATE public.gallery_images image
   SET commodity_type_id = NULL
 WHERE image.commodity_type_id IN (SELECT id FROM legacy_pallets);

WITH freight_forwarding AS (
  SELECT service_type.id
    FROM public.service_types service_type
   WHERE upper(regexp_replace(btrim(coalesce(service_type.name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
      OR upper(regexp_replace(btrim(coalesce(service_type.display_name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
), legacy_pallets AS (
  SELECT type.id
    FROM public.commodity_types type
    JOIN freight_forwarding service_type ON service_type.id = type.service_type_id
   WHERE lower(regexp_replace(btrim(type.name), '[[:space:]]+', ' ', 'g')) = 'pallets'
)
UPDATE public.shipping_agency_inquiries inquiry
   SET commodity_type_id = NULL
 WHERE inquiry.commodity_type_id IN (SELECT id FROM legacy_pallets);

WITH freight_forwarding AS (
  SELECT service_type.id
    FROM public.service_types service_type
   WHERE upper(regexp_replace(btrim(coalesce(service_type.name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
      OR upper(regexp_replace(btrim(coalesce(service_type.display_name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
)
DELETE FROM public.commodity_types type
 USING freight_forwarding service_type
 WHERE type.service_type_id = service_type.id
   AND lower(regexp_replace(btrim(type.name), '[[:space:]]+', ' ', 'g')) = 'pallets';
