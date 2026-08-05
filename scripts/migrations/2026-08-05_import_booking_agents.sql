-- Forward-only data migration sourced from D:/agent.xlsx.
-- Agent is represented by booking_partners.customer_type = 'AGENT'.
-- It is intentionally not written to booking_partner_addition_types.

WITH source (
  name,
  customer_id,
  country,
  city,
  address,
  contacts,
  phone,
  customer_status,
  customer_type,
  approve_status,
  invoice_company_name,
  invoice_company_address,
  invoice_company_phone,
  created_at
) AS (
  VALUES
    (
      'WLS LOGISTIC LIMITED',
      'WLSLOGISTI2607004',
      'CN',
      'GUANGZHOU',
      'ROOM 7A05, 7/F., JINZHOU INT''L BUSINESS CENTRE, 899 JIEFANG NORTH ROAD, YUEXIU DISTRICT, GUANGZHOU, CHINA',
      '[{"person":"MR BILLY"},{"person":"MS. RUTY"}]'::jsonb,
      '020-86213191',
      'LEAD',
      'AGENT',
      'APPROVED',
      'WLS LOGISTIC LIMITED',
      'ROOM 7A05, 7/F., JINZHOU INT''L BUSINESS CENTRE, 899 JIEFANG NORTH ROAD, YUEXIU DISTRICT, GUANGZHOU, CHINA',
      '020-86213191',
      '2026-07-29 00:00:00+07'::timestamptz
    ),
    (
      'PT. MATTROY LOGISTICS',
      'PT.MATTROY2511003',
      'ID',
      'JAKARTA',
      'GEDUNG PERKANTORAN PULOMAS SATU, JL. JEND AHMAD YANI NO. 2, JAKARTA 13210, INDONESIA',
      '[]'::jsonb,
      '+6221-22471974, +6221-29847271, +6221-29847253',
      'LEAD',
      'AGENT',
      'APPROVED',
      'PT. MATTROY LOGISTICS',
      'GEDUNG PERKANTORAN PULOMAS SATU, JL. JEND AHMAD YANI NO. 2, JAKARTA 13210, INDONESIA',
      '+6221-22471974, +6221-29847271, +6221-29847253',
      '2025-11-06 00:00:00+07'::timestamptz
    ),
    (
      'THE WORLD SHIPPING (CHINA) LIMITED',
      'THEWORLDSH2508007',
      'CN',
      'GUANGZHOU',
      'ROOM S2406, GUANGZHOU WORLD TRADE CENTRE, 371-375 HUAN SHI DONG ROAD, GUANGZHOU, CHINA',
      '[{"person":"MR BILLY"},{"person":"MS. RUTY"}]'::jsonb,
      '86-20-8730 2482',
      'LEAD',
      'AGENT',
      'APPROVED',
      'THE WORLD SHIPPING (CHINA) LIMITED',
      'ROOM S2406, GUANGZHOU WORLD TRADE CENTRE, 371-375 HUAN SHI DONG ROAD, GUANGZHOU, CHINA',
      '86-20-8730 2482',
      '2025-08-13 00:00:00+07'::timestamptz
    )
)
INSERT INTO booking_partners (
  name,
  customer_id,
  country,
  city,
  address,
  contacts,
  phone,
  customer_status,
  customer_type,
  tax_number,
  approve_status,
  invoice_company_name,
  invoice_company_address,
  invoice_company_phone,
  created_by,
  created_at,
  updated_by,
  updated_at
)
SELECT
  source.name,
  source.customer_id,
  source.country,
  source.city,
  source.address,
  source.contacts,
  source.phone,
  source.customer_status::booking_partners_customer_status_enum,
  source.customer_type::booking_partners_customer_type_enum,
  NULL,
  source.approve_status::booking_partners_approve_status_enum,
  source.invoice_company_name,
  source.invoice_company_address,
  source.invoice_company_phone,
  'migration:agent.xlsx:2026-08-05',
  source.created_at,
  'migration:agent.xlsx:2026-08-05',
  NOW()
FROM source
WHERE NOT EXISTS (
  SELECT 1
  FROM booking_partners existing
  WHERE existing.deleted_at IS NULL
    AND existing.customer_type = 'AGENT'
    AND UPPER(BTRIM(existing.name)) = UPPER(BTRIM(source.name))
)
ON CONFLICT (customer_id) DO NOTHING;
