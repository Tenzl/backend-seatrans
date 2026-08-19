-- Data only: seed the runtime catalog without rewriting document snapshots.
WITH canonical_package_types(display_name, sort_order) AS (
  VALUES
    -- CANONICAL_PACKAGE_TYPES_BEGIN
    ('CRT', 1),
    ('PKGS', 2),
    ('CAS', 3),
    ('BAL', 4),
    ('CTNS', 5),
    ('BAG(S)', 6),
    ('BALE(S)', 7),
    ('BOX(S)', 8),
    ('BULK(S)', 9),
    ('BUNDLE(S)', 10),
    ('CARTON(S)', 11),
    ('CASE(S)', 12),
    ('COIL(S)', 13),
    ('CRATE(S)', 14),
    ('CYLINDER(S)', 15),
    ('DRUM(S)', 16),
    ('JUMBO BAG(S)', 17),
    ('LINE DETENTION', 18),
    ('PACKAGE(S)', 19),
    ('PACKING CARTON(S)', 20),
    ('PALLET(S)', 21),
    ('PIECES', 22),
    ('WOODEN BOX(S)', 23),
    ('WOODEN CRATES', 24),
    ('WOODEN CASE(S)', 25),
    ('ROLL(S)', 26),
    ('SET(S)', 27),
    ('UNIT(S)', 28),
    ('STEEL DRUMS', 29),
    ('CLEATED PLYWOOD BOXES', 30),
    ('FIBREBOARD BOXES', 31),
    ('CARDBOARD BOXES', 32),
    ('DOZEN', 33),
    ('PAIR', 34),
    ('PAIL', 35),
    ('CASKS', 36),
    ('KEGS', 37),
    ('SLAB(S)', 38),
    ('SACK', 39),
    ('SKIDS', 40),
    ('BARRELS', 41),
    ('BLISTER', 42),
    ('CAN', 43),
    ('CUP', 44),
    ('CAPSULE', 45),
    ('FOIL', 46),
    ('PACKET', 47),
    ('TABLET', 48),
    ('TANK', 49),
    ('TOTE', 50),
    ('BOTTLE', 51),
    ('FLOWPACK', 52),
    ('JAR', 53),
    ('TRAY', 54),
    ('CAGE', 55),
    ('ROLL CAGE', 56),
    ('SLIT BOX', 57),
    ('PRESSURIZED CONTAINER', 58),
    ('BA', 59),
    ('BE', 60),
    ('BG', 61),
    ('BK', 62),
    ('BASKET(S)', 63),
    ('BL', 64),
    ('BN', 65),
    ('BR', 66),
    ('BX', 67),
    ('CA', 68),
    ('CG', 69),
    ('CK', 70),
    ('CL', 71),
    ('CN', 72),
    ('CO', 73),
    ('CP', 74),
    ('CR', 75),
    ('CS', 76),
    ('CT', 77),
    ('CX', 78),
    ('CY', 79),
    ('DR', 80),
    ('KG', 81),
    ('LG', 82),
    ('LZ', 83),
    ('MST', 84),
    ('MT', 85),
    ('NE', 86),
    ('NT', 87),
    ('PA', 88),
    ('PC', 89),
    ('PE', 90),
    ('PG', 91),
    ('PI', 92),
    ('PK', 93),
    ('PL', 94),
    ('PP', 95),
    ('PLTS', 96),
    ('PS', 97),
    ('PU', 98),
    ('RL', 99),
    ('TY', 100),
    ('ZZ', 101)
    -- CANONICAL_PACKAGE_TYPES_END
)
INSERT INTO public.package_types (
  code,
  display_name,
  is_active,
  sort_order
)
SELECT
  upper(regexp_replace(btrim(display_name), '[[:space:]]+', ' ', 'g')),
  display_name,
  TRUE,
  sort_order
FROM canonical_package_types
ON CONFLICT (
  lower(regexp_replace(btrim(code), '[[:space:]]+', ' ', 'g'))
)
DO NOTHING;

WITH document_package_types(raw_value) AS (
  SELECT container ->> 'packageType'
    FROM public.bill_of_lading_records
   CROSS JOIN LATERAL jsonb_array_elements(
     CASE
       WHEN jsonb_typeof(payload -> 'containers') = 'array'
         THEN payload -> 'containers'
       ELSE '[]'::jsonb
     END
   ) AS container
  UNION ALL
  SELECT container ->> 'packageType'
    FROM public.arrival_notice_records
   CROSS JOIN LATERAL jsonb_array_elements(
     CASE
       WHEN jsonb_typeof(payload -> 'containers') = 'array'
         THEN payload -> 'containers'
       ELSE '[]'::jsonb
     END
   ) AS container
  UNION ALL
  SELECT container ->> 'packageType'
    FROM public.delivery_order_records
   CROSS JOIN LATERAL jsonb_array_elements(
     CASE
       WHEN jsonb_typeof(payload -> 'containers') = 'array'
         THEN payload -> 'containers'
       ELSE '[]'::jsonb
     END
   ) AS container
),
normalized_package_types AS (
  SELECT
    upper(regexp_replace(btrim(raw_value), '[[:space:]]+', ' ', 'g')) AS code,
    min(
      regexp_replace(btrim(raw_value), '[[:space:]]+', ' ', 'g')
      COLLATE "C"
    ) AS display_name
  FROM document_package_types
  WHERE raw_value IS NOT NULL
    AND btrim(raw_value) <> ''
  GROUP BY upper(
    regexp_replace(btrim(raw_value), '[[:space:]]+', ' ', 'g')
  )
),
ordered_package_types AS (
  SELECT
    code,
    display_name,
    1000 + row_number() OVER (ORDER BY code) AS sort_order
  FROM normalized_package_types
)
INSERT INTO public.package_types (
  code,
  display_name,
  is_active,
  sort_order
)
SELECT code, display_name, TRUE, sort_order
FROM ordered_package_types
ON CONFLICT (
  lower(regexp_replace(btrim(code), '[[:space:]]+', ' ', 'g'))
)
DO NOTHING;
