-- Merge six duplicate booking partners into their selected keeper rows.
-- The guarded runner backs up and locks all 12 rows before executing this SQL.

WITH pairs(keep_id, duplicate_id) AS (
  VALUES
    (111, 39),
    (48, 122),
    (2, 11),
    (19, 37),
    (30, 90),
    (75, 31),
    (32, 94),
    (13, 28),
    (23, 92),
    (35, 95)
)
UPDATE booking_partners AS keeper
SET
  name = COALESCE(NULLIF(BTRIM(keeper.name), ''), duplicate.name),
  country = COALESCE(NULLIF(BTRIM(keeper.country), ''), duplicate.country),
  city = COALESCE(NULLIF(BTRIM(keeper.city), ''), duplicate.city),
  phone = COALESCE(NULLIF(BTRIM(keeper.phone), ''), duplicate.phone),
  fax = COALESCE(NULLIF(BTRIM(keeper.fax), ''), duplicate.fax),
  tracking_url = COALESCE(NULLIF(BTRIM(keeper.tracking_url), ''), duplicate.tracking_url),
  address = COALESCE(NULLIF(BTRIM(keeper.address), ''), duplicate.address),
  customer_status = COALESCE(keeper.customer_status, duplicate.customer_status),
  customer_type = COALESCE(keeper.customer_type, duplicate.customer_type),
  tax_number = COALESCE(NULLIF(BTRIM(keeper.tax_number), ''), duplicate.tax_number),
  approve_status = COALESCE(keeper.approve_status, duplicate.approve_status),
  approve_by = COALESCE(NULLIF(BTRIM(keeper.approve_by), ''), duplicate.approve_by),
  company_establishment_date = COALESCE(keeper.company_establishment_date, duplicate.company_establishment_date),
  payment_due_days = COALESCE(keeper.payment_due_days, duplicate.payment_due_days),
  contract_no = COALESCE(NULLIF(BTRIM(keeper.contract_no), ''), duplicate.contract_no),
  invoice_company_name = COALESCE(NULLIF(BTRIM(keeper.invoice_company_name), ''), duplicate.invoice_company_name),
  invoice_company_address = COALESCE(NULLIF(BTRIM(keeper.invoice_company_address), ''), duplicate.invoice_company_address),
  invoice_company_phone = COALESCE(NULLIF(BTRIM(keeper.invoice_company_phone), ''), duplicate.invoice_company_phone),
  invoice_company_email = COALESCE(NULLIF(BTRIM(keeper.invoice_company_email), ''), duplicate.invoice_company_email),
  invoice_bank_name = COALESCE(NULLIF(BTRIM(keeper.invoice_bank_name), ''), duplicate.invoice_bank_name),
  invoice_bank_branch = COALESCE(NULLIF(BTRIM(keeper.invoice_bank_branch), ''), duplicate.invoice_bank_branch),
  invoice_bank_account = COALESCE(NULLIF(BTRIM(keeper.invoice_bank_account), ''), duplicate.invoice_bank_account),
  locked_at = COALESCE(keeper.locked_at, duplicate.locked_at),
  contacts = COALESCE(
    (
      SELECT jsonb_agg(contact ORDER BY contact::text)
      FROM (
        SELECT DISTINCT value AS contact
        FROM jsonb_array_elements(
          COALESCE(keeper.contacts, '[]'::jsonb) ||
          COALESCE(duplicate.contacts, '[]'::jsonb)
        )
      ) AS merged_contacts
    ),
    '[]'::jsonb
  ),
  updated_by = 'migration:booking-partner-dedupe-20260820',
  updated_at = NOW(),
  version = keeper.version + 1
FROM pairs
JOIN booking_partners AS duplicate ON duplicate.id = pairs.duplicate_id
WHERE keeper.id = pairs.keep_id;

INSERT INTO booking_partner_addition_types (partner_id, addition_type)
SELECT pairs.keep_id, duplicate_type.addition_type
FROM (
  VALUES
    (111, 39),
    (48, 122),
    (2, 11),
    (19, 37),
    (30, 90),
    (75, 31),
    (32, 94),
    (13, 28),
    (23, 92),
    (35, 95)
)
  AS pairs(keep_id, duplicate_id)
JOIN booking_partner_addition_types AS duplicate_type
  ON duplicate_type.partner_id = pairs.duplicate_id
ON CONFLICT (partner_id, addition_type) DO NOTHING;

UPDATE booking_partners
SET
  address = 'HAMLET 5, VAN HOI 2 VILLAGE, TUY PHUOC COMMUNE, GIA LAI PROVINCE, VIETNAM',
  customer_status = 'LEAD',
  customer_type = 'OTHER',
  invoice_company_name = 'HOANG THACH SON COMPANY LTD',
  invoice_company_address = 'HAMLET 5, VAN HOI 2 VILLAGE, TUY PHUOC COMMUNE, GIA LAI PROVINCE, VIETNAM'
WHERE id = 111;

UPDATE booking_partners
SET address = 'SECTION 5, QUY NHON BAC WARD, GIA LAI PROVINCE, VIETNAM'
WHERE id = 48;

UPDATE booking_partners SET customer_status = 'LEAD' WHERE id = 2;

UPDATE booking_partners
SET
  address = 'GROUP 10, AREA 7, QUY NHON TAY WARD, GIA LAI PROVINCE, VIETNAM',
  invoice_company_address = 'GROUP 10, AREA 7, QUY NHON TAY WARD, GIA LAI PROVINCE, VIETNAM'
WHERE id = 19;

UPDATE booking_partners
SET
  city = 'Quy Nhon',
  address = 'LOT B43, PHU TAI INDUSTRIAL ZONE, QUY NHON BAC WARD, GIA LAI PROVINCE, VIETNAM',
  invoice_company_address = 'LOT B43, PHU TAI INDUSTRIAL ZONE, QUY NHON BAC WARD, GIA LAI PROVINCE, VIETNAM'
WHERE id = 30;

UPDATE booking_partners
SET
  name = 'NEW DRAGON GRANITE CO., LTD',
  address = '147 TANG BAT HO, QUY NHON WARD, GIA LAI PROVINCE, VIETNAM',
  customer_status = 'LEAD',
  customer_type = 'DIRECT',
  invoice_company_name = 'NEW DRAGON GRANITE CO., LTD',
  invoice_company_address = '147 TANG BAT HO, QUY NHON WARD, GIA LAI PROVINCE, VIETNAM'
WHERE id = 75;

UPDATE booking_partners
SET
  name = 'HONGC USING ENTERPRISE CO., LTD.',
  address = '5F.-2, NO. 81, SEC. 4, WENXIN RD., SHUINAN VIL., BEITUN DIST., TAICHUNG CITY 40667, TAIWAN (R.O.C.)',
  invoice_company_name = 'HONGC USING ENTERPRISE CO., LTD.',
  invoice_company_address = '5F.-2, NO. 81, SEC. 4, WENXIN RD., SHUINAN VIL., BEITUN DIST., TAICHUNG CITY 40667, TAIWAN (R.O.C.)'
WHERE id = 13;

UPDATE booking_partners
SET
  name = 'MIKUNI SANGYO CO., LTD',
  invoice_company_name = 'MIKUNI SANGYO CO., LTD'
WHERE id = 23;

DELETE FROM booking_partners
WHERE id = ANY(ARRAY[39, 122, 11, 37, 90, 31, 94, 28, 92, 95]);
