DO $commodity_type_code_identity_data$
DECLARE
  shipping_agency_service_id integer;
  shipping_agency_service_count integer;
  ambiguous_type_code_count integer;
  unresolved_inquiry_count integer;
  conflicting_inquiry_id_count integer;
  malformed_epda_rate_count integer;
  unresolved_epda_rate_count integer;
  conflicting_epda_rate_id_count integer;
BEGIN
  SELECT count(*)::integer, min(id)
    INTO shipping_agency_service_count, shipping_agency_service_id
    FROM public.service_types
   WHERE trim(BOTH '_' FROM regexp_replace(upper(btrim(name)), '[^A-Z0-9]+', '_', 'g')) = 'SHIPPING_AGENCY'
      OR trim(BOTH '_' FROM regexp_replace(upper(btrim(display_name)), '[^A-Z0-9]+', '_', 'g')) = 'SHIPPING_AGENCY';

  IF shipping_agency_service_count <> 1 THEN
    RAISE EXCEPTION
      'Commodity Type identity data: expected one Shipping Agency Service, found %',
      shipping_agency_service_count;
  END IF;

  SELECT count(*)::integer
    INTO ambiguous_type_code_count
    FROM (
      SELECT trim(BOTH '_' FROM regexp_replace(upper(btrim(code)), '[^A-Z0-9]+', '_', 'g'))
        FROM public.commodity_types
       WHERE service_type_id = shipping_agency_service_id
       GROUP BY trim(BOTH '_' FROM regexp_replace(upper(btrim(code)), '[^A-Z0-9]+', '_', 'g'))
      HAVING count(*) <> 1
    ) AS ambiguous_codes;

  IF ambiguous_type_code_count <> 0 THEN
    RAISE EXCEPTION
      'Commodity Type identity data: ambiguous Commodity Type codes: %',
      ambiguous_type_code_count;
  END IF;

  SELECT count(*)::integer
    INTO unresolved_inquiry_count
    FROM public.shipping_agency_inquiries AS inquiry
   WHERE (
     SELECT count(*)
       FROM public.commodity_types AS commodity_type
      WHERE commodity_type.service_type_id = shipping_agency_service_id
        AND trim(BOTH '_' FROM regexp_replace(upper(btrim(commodity_type.code)), '[^A-Z0-9]+', '_', 'g')) =
            trim(BOTH '_' FROM regexp_replace(upper(btrim(coalesce(inquiry.cargo_type, ''))), '[^A-Z0-9]+', '_', 'g'))
   ) <> 1;

  IF unresolved_inquiry_count <> 0 THEN
    RAISE EXCEPTION
      'Commodity Type identity data: unresolved inquiry cargo_type rows: %',
      unresolved_inquiry_count;
  END IF;

  SELECT count(*)::integer
    INTO conflicting_inquiry_id_count
    FROM public.shipping_agency_inquiries AS inquiry
    JOIN public.commodity_types AS commodity_type
      ON commodity_type.service_type_id = shipping_agency_service_id
     AND trim(BOTH '_' FROM regexp_replace(upper(btrim(commodity_type.code)), '[^A-Z0-9]+', '_', 'g')) =
         trim(BOTH '_' FROM regexp_replace(upper(btrim(coalesce(inquiry.cargo_type, ''))), '[^A-Z0-9]+', '_', 'g'))
   WHERE inquiry.commodity_type_id IS NOT NULL
     AND inquiry.commodity_type_id IS DISTINCT FROM commodity_type.id;

  IF conflicting_inquiry_id_count <> 0 THEN
    RAISE EXCEPTION
      'Commodity Type identity data: conflicting inquiry stored Type IDs: %',
      conflicting_inquiry_id_count;
  END IF;

  SELECT count(*)::integer
    INTO malformed_epda_rate_count
    FROM public.epda_parameter_set AS parameter_set
   WHERE parameter_set.values ? 'cargoAgencyRates'
     AND jsonb_typeof(parameter_set.values->'cargoAgencyRates') IS DISTINCT FROM 'array';

  SELECT malformed_epda_rate_count + count(*)::integer
    INTO malformed_epda_rate_count
    FROM public.epda_parameter_set AS parameter_set
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(parameter_set.values->'cargoAgencyRates') = 'array'
          THEN parameter_set.values->'cargoAgencyRates'
        ELSE '[]'::jsonb
      END
    ) AS rate
   WHERE jsonb_typeof(parameter_set.values->'cargoAgencyRates') = 'array'
     AND (
       jsonb_typeof(rate) IS DISTINCT FROM 'object'
       OR jsonb_typeof(rate->'code') IS DISTINCT FROM 'string'
       OR btrim(coalesce(rate->>'code', '')) = ''
       OR jsonb_typeof(rate->'label') IS DISTINCT FROM 'string'
       OR jsonb_typeof(rate->'rate') IS DISTINCT FROM 'number'
       OR (
         rate ? 'commodityTypeId'
         AND rate->'commodityTypeId' <> 'null'::jsonb
         AND (
           jsonb_typeof(rate->'commodityTypeId') IS DISTINCT FROM 'number'
           OR rate->>'commodityTypeId' !~ '^[1-9][0-9]*$'
         )
       )
       OR (
         rate ? 'typeNameSnapshot'
         AND rate->'typeNameSnapshot' <> 'null'::jsonb
         AND jsonb_typeof(rate->'typeNameSnapshot') IS DISTINCT FROM 'string'
       )
     );

  IF malformed_epda_rate_count <> 0 THEN
    RAISE EXCEPTION
      'Commodity Type identity data: malformed EPDA cargoAgencyRates rows: %',
      malformed_epda_rate_count;
  END IF;

  SELECT count(*)::integer
    INTO unresolved_epda_rate_count
    FROM public.epda_parameter_set AS parameter_set
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(parameter_set.values->'cargoAgencyRates') = 'array'
          THEN parameter_set.values->'cargoAgencyRates'
        ELSE '[]'::jsonb
      END
    ) AS rate
   WHERE jsonb_typeof(parameter_set.values->'cargoAgencyRates') = 'array'
     AND (
       SELECT count(*)
         FROM public.commodity_types AS commodity_type
        WHERE commodity_type.service_type_id = shipping_agency_service_id
          AND trim(BOTH '_' FROM regexp_replace(upper(btrim(commodity_type.code)), '[^A-Z0-9]+', '_', 'g')) =
              trim(BOTH '_' FROM regexp_replace(upper(btrim(rate->>'code')), '[^A-Z0-9]+', '_', 'g'))
     ) <> 1;

  IF unresolved_epda_rate_count <> 0 THEN
    RAISE EXCEPTION
      'Commodity Type identity data: unresolved EPDA cargoAgencyRates rows: %',
      unresolved_epda_rate_count;
  END IF;

  SELECT count(*)::integer
    INTO conflicting_epda_rate_id_count
    FROM public.epda_parameter_set AS parameter_set
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(parameter_set.values->'cargoAgencyRates') = 'array'
          THEN parameter_set.values->'cargoAgencyRates'
        ELSE '[]'::jsonb
      END
    ) AS rate
    JOIN public.commodity_types AS commodity_type
      ON commodity_type.service_type_id = shipping_agency_service_id
     AND trim(BOTH '_' FROM regexp_replace(upper(btrim(commodity_type.code)), '[^A-Z0-9]+', '_', 'g')) =
         trim(BOTH '_' FROM regexp_replace(upper(btrim(rate->>'code')), '[^A-Z0-9]+', '_', 'g'))
   WHERE jsonb_typeof(parameter_set.values->'cargoAgencyRates') = 'array'
     AND (
       (
         rate ? 'commodityTypeId'
         AND rate->'commodityTypeId' <> 'null'::jsonb
         AND (rate->>'commodityTypeId')::integer IS DISTINCT FROM commodity_type.id
       )
     );

  IF conflicting_epda_rate_id_count <> 0 THEN
    RAISE EXCEPTION
      'Commodity Type identity data: conflicting EPDA stored Type IDs or snapshots: %',
      conflicting_epda_rate_id_count;
  END IF;

  UPDATE public.shipping_agency_inquiries AS inquiry
     SET commodity_type_id = commodity_type.id
    FROM public.commodity_types AS commodity_type
   WHERE commodity_type.service_type_id = shipping_agency_service_id
     AND trim(BOTH '_' FROM regexp_replace(upper(btrim(commodity_type.code)), '[^A-Z0-9]+', '_', 'g')) =
         trim(BOTH '_' FROM regexp_replace(upper(btrim(inquiry.cargo_type)), '[^A-Z0-9]+', '_', 'g'))
     AND inquiry.commodity_type_id IS DISTINCT FROM commodity_type.id;

  WITH enriched_parameter_sets AS (
    SELECT
      parameter_set.id,
      jsonb_agg(
        rate || jsonb_build_object(
          'commodityTypeId', commodity_type.id,
          'typeNameSnapshot', coalesce(
            nullif(btrim(rate->>'typeNameSnapshot'), ''),
            commodity_type.name
          )
        )
        ORDER BY rate_row.ordinality
      ) AS cargo_agency_rates
    FROM public.epda_parameter_set AS parameter_set
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(parameter_set.values->'cargoAgencyRates') = 'array'
          THEN parameter_set.values->'cargoAgencyRates'
        ELSE '[]'::jsonb
      END
    ) WITH ORDINALITY AS rate_row(rate, ordinality)
    JOIN public.commodity_types AS commodity_type
      ON commodity_type.service_type_id = shipping_agency_service_id
     AND trim(BOTH '_' FROM regexp_replace(upper(btrim(commodity_type.code)), '[^A-Z0-9]+', '_', 'g')) =
         trim(BOTH '_' FROM regexp_replace(upper(btrim(rate->>'code')), '[^A-Z0-9]+', '_', 'g'))
   WHERE jsonb_typeof(parameter_set.values->'cargoAgencyRates') = 'array'
   GROUP BY parameter_set.id
  )
  UPDATE public.epda_parameter_set AS parameter_set
     SET values = jsonb_set(
       parameter_set.values,
       '{cargoAgencyRates}',
       enriched.cargo_agency_rates,
       false
     )
    FROM enriched_parameter_sets AS enriched
   WHERE parameter_set.id = enriched.id
     AND parameter_set.values->'cargoAgencyRates'
         IS DISTINCT FROM enriched.cargo_agency_rates;
END
$commodity_type_code_identity_data$;
