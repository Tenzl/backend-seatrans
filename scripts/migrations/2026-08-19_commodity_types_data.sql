WITH group_sources AS (
  SELECT
    cg.service_type_id,
    regexp_replace(btrim(cg.name), '\s+', ' ', 'g') AS display_name,
    trim(BOTH '_' FROM regexp_replace(upper(btrim(cg.name)), '[^A-Z0-9]+', '_', 'g')) AS raw_code,
    1 AS source_priority,
    cg.id AS source_id
  FROM public.commodity_groups cg
  WHERE btrim(cg.name) <> ''
), cargo_type_sources AS (
  SELECT
    st.id AS service_type_id,
    regexp_replace(
      btrim(coalesce(nullif(ct.display_label, ''), ct.code)),
      '\s+',
      ' ',
      'g'
    ) AS display_name,
    trim(BOTH '_' FROM regexp_replace(upper(btrim(ct.code)), '[^A-Z0-9]+', '_', 'g')) AS raw_code,
    2 AS source_priority,
    row_number() OVER (ORDER BY ct.service_type_type, ct.code)::integer AS source_id
  FROM public.cargo_types ct
  JOIN public.service_types st
    ON trim(BOTH '_' FROM regexp_replace(upper(btrim(ct.service_type_type)), '[^A-Z0-9]+', '_', 'g'))
       IN (
         trim(BOTH '_' FROM regexp_replace(upper(btrim(st.name)), '[^A-Z0-9]+', '_', 'g')),
         trim(BOTH '_' FROM regexp_replace(upper(btrim(st.display_name)), '[^A-Z0-9]+', '_', 'g'))
       )
  WHERE btrim(ct.code) <> ''
), canonical_sources AS (
  SELECT
    service_type_id,
    display_name,
    CASE
      WHEN raw_code = 'EQUIPMENT' THEN 'IN_EQUIPMENT'
      WHEN left(raw_code, 3) = 'IN_' THEN raw_code
      ELSE 'IN_' || raw_code
    END AS code,
    source_priority,
    source_id
  FROM (
    SELECT * FROM group_sources
    UNION ALL
    SELECT * FROM cargo_type_sources
  ) sources
  WHERE raw_code <> ''
), ranked_sources AS (
  SELECT
    service_type_id,
    code,
    display_name AS name,
    row_number() OVER (
      PARTITION BY service_type_id, lower(btrim(code))
      ORDER BY source_priority, source_id
    ) AS source_rank
  FROM canonical_sources
)
INSERT INTO public.commodity_types (
  service_type_id,
  code,
  name,
  created_at,
  updated_at
)
SELECT service_type_id, code, name, NOW(), NOW()
FROM ranked_sources
WHERE source_rank = 1
ORDER BY service_type_id, code
ON CONFLICT DO NOTHING;
