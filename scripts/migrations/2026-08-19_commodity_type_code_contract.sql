DO $commodity_type_code_contract$
DECLARE
  blocker_count integer;
BEGIN
  SELECT count(*)::integer
    INTO blocker_count
    FROM public.epda_parameter_set AS parameter_set
   WHERE parameter_set.values ? 'cargoAgencyRates'
     AND jsonb_typeof(parameter_set.values -> 'cargoAgencyRates') IS DISTINCT FROM 'array';

  IF blocker_count <> 0 THEN
    RAISE EXCEPTION
      'Commodity Type code contract refused: % EPDA cargoAgencyRates values are not arrays',
      blocker_count;
  END IF;

  SELECT count(*)::integer
    INTO blocker_count
    FROM public.epda_parameter_set AS parameter_set
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(parameter_set.values -> 'cargoAgencyRates') = 'array'
          THEN parameter_set.values -> 'cargoAgencyRates'
        ELSE '[]'::jsonb
      END
    ) WITH ORDINALITY AS rate_entry(rate_value, rate_ordinality)
    LEFT JOIN public.commodity_types AS commodity_type
      ON jsonb_typeof(rate_entry.rate_value -> 'commodityTypeId') = 'number'
     AND rate_entry.rate_value ->> 'commodityTypeId' ~ '^[1-9][0-9]*$'
     AND commodity_type.id::text = rate_entry.rate_value ->> 'commodityTypeId'
   WHERE jsonb_typeof(rate_entry.rate_value) IS DISTINCT FROM 'object'
      OR jsonb_typeof(rate_entry.rate_value -> 'commodityTypeId') IS DISTINCT FROM 'number'
      OR rate_entry.rate_value ->> 'commodityTypeId' !~ '^[1-9][0-9]*$'
      OR commodity_type.id IS NULL
      OR jsonb_typeof(rate_entry.rate_value -> 'typeNameSnapshot') IS DISTINCT FROM 'string'
      OR btrim(rate_entry.rate_value ->> 'typeNameSnapshot') = ''
      OR jsonb_typeof(rate_entry.rate_value -> 'label') IS DISTINCT FROM 'string'
      OR jsonb_typeof(rate_entry.rate_value -> 'rate') IS DISTINCT FROM 'number';

  IF blocker_count <> 0 THEN
    RAISE EXCEPTION
      'Commodity Type code contract refused: % malformed, unresolved, or non-ID EPDA rates',
      blocker_count;
  END IF;

  SELECT count(*)::integer
    INTO blocker_count
    FROM (
      SELECT parameter_set.id,
             rate_entry.rate_value ->> 'commodityTypeId' AS commodity_type_id
        FROM public.epda_parameter_set AS parameter_set
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(parameter_set.values -> 'cargoAgencyRates') = 'array'
              THEN parameter_set.values -> 'cargoAgencyRates'
            ELSE '[]'::jsonb
          END
        ) AS rate_entry(rate_value)
       GROUP BY parameter_set.id,
                rate_entry.rate_value ->> 'commodityTypeId'
      HAVING count(*) > 1
    ) AS duplicate_rates;

  IF blocker_count <> 0 THEN
    RAISE EXCEPTION
      'Commodity Type code contract refused: % duplicate Type-ID rate groups',
      blocker_count;
  END IF;

  UPDATE public.epda_parameter_set AS parameter_set
     SET values = jsonb_set(
       parameter_set.values,
       '{cargoAgencyRates}',
       COALESCE(
         (
           SELECT jsonb_agg(
             rate_entry.rate_value - 'code'
             ORDER BY rate_entry.rate_ordinality
           )
             FROM jsonb_array_elements(
               CASE
                 WHEN jsonb_typeof(parameter_set.values -> 'cargoAgencyRates') = 'array'
                   THEN parameter_set.values -> 'cargoAgencyRates'
                 ELSE '[]'::jsonb
               END
             ) WITH ORDINALITY AS rate_entry(rate_value, rate_ordinality)
         ),
         '[]'::jsonb
       ),
       false
     )
   WHERE parameter_set.values ? 'cargoAgencyRates'
     AND jsonb_typeof(parameter_set.values -> 'cargoAgencyRates') = 'array'
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(
           parameter_set.values -> 'cargoAgencyRates'
         ) AS rate_entry(rate_value)
        WHERE rate_entry.rate_value ? 'code'
     );

  DROP INDEX IF EXISTS public.uq_commodity_types_service_code_normalized;
  ALTER TABLE public.commodity_types
    DROP CONSTRAINT IF EXISTS ck_commodity_types_code_nonblank;
  ALTER TABLE public.commodity_types
    DROP COLUMN IF EXISTS code;
END
$commodity_type_code_contract$;
