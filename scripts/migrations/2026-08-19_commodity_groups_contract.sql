-- Contract only. Apply after the independent catalogs release has completed
-- its approved observation window and a backup plus logical export exist.

CREATE UNIQUE INDEX uq_commodities_service_name_normalized
  ON public.commodities (
    service_type_id,
    lower(regexp_replace(btrim(name), '[[:space:]_/-]+', ' ', 'g'))
  );

ALTER TABLE public.commodities
  DROP COLUMN group_id,
  DROP COLUMN required_image_count,
  DROP COLUMN cargo_type;

DROP TABLE public.commodity_groups;
