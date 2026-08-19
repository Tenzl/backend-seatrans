-- Merge duplicate commodities independently within each Service.
-- The runner must take a checksummed logical export before this script is applied.

CREATE TEMP TABLE _independent_commodity_reference_counts (
  id bigint PRIMARY KEY,
  total_refs bigint NOT NULL
) ON COMMIT DROP;

INSERT INTO _independent_commodity_reference_counts (id, total_refs)
SELECT c.id,
       (SELECT count(*) FROM public.gallery_images g WHERE g.commodity_id = c.id)
       + CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'shipping_agency_inquiries'
             AND column_name = 'commodity_id'
         ) THEN 0 ELSE 0 END
       + (SELECT count(*) FROM public.booking_records r
          WHERE r.payload ->> 'commodityId' ~ '^[0-9]+$'
            AND (r.payload ->> 'commodityId')::bigint = c.id)
       + (SELECT count(*) FROM public.arrival_notice_records r
          WHERE r.payload ->> 'commodityId' ~ '^[0-9]+$'
            AND (r.payload ->> 'commodityId')::bigint = c.id)
       + (SELECT count(*) FROM public.delivery_order_records r
          WHERE r.payload ->> 'commodityId' ~ '^[0-9]+$'
            AND (r.payload ->> 'commodityId')::bigint = c.id)
       + (SELECT count(*) FROM public.bill_of_lading_records r
          WHERE r.payload ->> 'commodityId' ~ '^[0-9]+$'
            AND (r.payload ->> 'commodityId')::bigint = c.id)
FROM public.commodities c;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shipping_agency_inquiries'
      AND column_name = 'commodity_id'
  ) THEN
    EXECUTE $sql$
      UPDATE _independent_commodity_reference_counts rc
      SET total_refs = rc.total_refs + refs.ref_count
      FROM (
        SELECT commodity_id AS id, count(*)::bigint AS ref_count
        FROM public.shipping_agency_inquiries
        WHERE commodity_id IS NOT NULL
        GROUP BY commodity_id
      ) refs
      WHERE refs.id = rc.id
    $sql$;
  END IF;
END
$block$;

CREATE TEMP TABLE _independent_commodity_ranked ON COMMIT DROP AS
SELECT c.id,
       c.service_type_id,
       lower(regexp_replace(btrim(c.name), '[[:space:]_/-]+', ' ', 'g')) AS normalized_name,
       rc.total_refs,
       ROW_NUMBER() OVER (
         PARTITION BY c.service_type_id,
           lower(regexp_replace(btrim(c.name), '[[:space:]_/-]+', ' ', 'g'))
         ORDER BY rc.total_refs DESC, c.id ASC
       ) AS duplicate_rank
FROM public.commodities c
JOIN _independent_commodity_reference_counts rc ON rc.id = c.id;

CREATE TEMP TABLE _independent_commodity_merge_map ON COMMIT DROP AS
SELECT duplicate.id AS duplicate_id, canonical.id AS canonical_id
FROM _independent_commodity_ranked duplicate
JOIN _independent_commodity_ranked canonical
  ON canonical.service_type_id = duplicate.service_type_id
 AND canonical.normalized_name = duplicate.normalized_name
 AND canonical.duplicate_rank = 1
WHERE duplicate.duplicate_rank > 1;

-- Preserve the first real description in deterministic reference/ID order.
WITH preferred AS (
  SELECT DISTINCT ON (r.service_type_id, r.normalized_name)
         r.service_type_id, r.normalized_name, c.description
  FROM _independent_commodity_ranked r
  JOIN public.commodities c ON c.id = r.id
  WHERE nullif(btrim(c.description), '') IS NOT NULL
    AND upper(btrim(c.description)) <> 'NULL'
  ORDER BY r.service_type_id, r.normalized_name, r.total_refs DESC, r.id ASC
)
UPDATE public.commodities canonical
SET description = preferred.description
FROM _independent_commodity_ranked ranked
JOIN preferred
  ON preferred.service_type_id = ranked.service_type_id
 AND preferred.normalized_name = ranked.normalized_name
WHERE ranked.id = canonical.id
  AND ranked.duplicate_rank = 1;

UPDATE public.gallery_images g
SET commodity_id = m.canonical_id
FROM _independent_commodity_merge_map m
WHERE g.commodity_id = m.duplicate_id;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shipping_agency_inquiries'
      AND column_name = 'commodity_id'
  ) THEN
    EXECUTE $sql$
      UPDATE public.shipping_agency_inquiries i
      SET commodity_id = m.canonical_id
      FROM _independent_commodity_merge_map m
      WHERE i.commodity_id = m.duplicate_id
    $sql$;
  END IF;
END
$block$;

UPDATE public.booking_records r
SET payload = jsonb_set(r.payload, '{commodityId}', to_jsonb(m.canonical_id), false)
FROM _independent_commodity_merge_map m
WHERE r.payload ->> 'commodityId' ~ '^[0-9]+$'
  AND (r.payload ->> 'commodityId')::bigint = m.duplicate_id;

UPDATE public.arrival_notice_records r
SET payload = jsonb_set(r.payload, '{commodityId}', to_jsonb(m.canonical_id), false)
FROM _independent_commodity_merge_map m
WHERE r.payload ->> 'commodityId' ~ '^[0-9]+$'
  AND (r.payload ->> 'commodityId')::bigint = m.duplicate_id;

UPDATE public.delivery_order_records r
SET payload = jsonb_set(r.payload, '{commodityId}', to_jsonb(m.canonical_id), false)
FROM _independent_commodity_merge_map m
WHERE r.payload ->> 'commodityId' ~ '^[0-9]+$'
  AND (r.payload ->> 'commodityId')::bigint = m.duplicate_id;

UPDATE public.bill_of_lading_records r
SET payload = jsonb_set(r.payload, '{commodityId}', to_jsonb(m.canonical_id), false)
FROM _independent_commodity_merge_map m
WHERE r.payload ->> 'commodityId' ~ '^[0-9]+$'
  AND (r.payload ->> 'commodityId')::bigint = m.duplicate_id;

DELETE FROM public.commodities c
USING _independent_commodity_merge_map m
WHERE c.id = m.duplicate_id;

UPDATE public.commodities
SET description = NULL
WHERE upper(btrim(description)) = 'NULL';

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.commodities
    GROUP BY service_type_id,
      lower(regexp_replace(btrim(name), '[[:space:]_/-]+', ' ', 'g'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate commodities remain after independent merge';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.gallery_images g
    LEFT JOIN public.commodities c ON c.id = g.commodity_id
    WHERE g.commodity_id IS NOT NULL AND c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'orphan gallery commodity reference remains';
  END IF;
END
$block$;
