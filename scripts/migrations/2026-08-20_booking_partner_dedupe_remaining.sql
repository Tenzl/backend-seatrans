-- Merge the eight remaining duplicate booking partners after the first dedupe.
WITH pairs(keep_id, duplicate_id) AS (
  VALUES
    (33, 83), (42, 50), (109, 97), (65, 64),
    (41, 43), (108, 80), (69, 68), (26, 25)
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
  contacts = COALESCE((
    SELECT jsonb_agg(contact ORDER BY contact::text)
    FROM (
      SELECT DISTINCT value AS contact
      FROM jsonb_array_elements(
        COALESCE(keeper.contacts, '[]'::jsonb) ||
        COALESCE(duplicate.contacts, '[]'::jsonb)
      )
    ) AS merged_contacts
  ), '[]'::jsonb),
  updated_by = 'migration:booking-partner-dedupe-remaining-20260820',
  updated_at = NOW(),
  version = keeper.version + 1
FROM pairs
JOIN booking_partners AS duplicate ON duplicate.id = pairs.duplicate_id
WHERE keeper.id = pairs.keep_id;

INSERT INTO booking_partner_addition_types (partner_id, addition_type)
SELECT pairs.keep_id, source_type.addition_type
FROM (VALUES
  (33, 83), (42, 50), (109, 97), (65, 64),
  (41, 43), (108, 80), (69, 68), (26, 25)
) AS pairs(keep_id, duplicate_id)
JOIN booking_partner_addition_types AS source_type
  ON source_type.partner_id = pairs.duplicate_id
ON CONFLICT (partner_id, addition_type) DO NOTHING;

UPDATE booking_partners SET
  address = '24/1 BONG SAO, BINH DONG WARD, HO CHI MINH CITY, VIETNAM',
  invoice_company_address = '24/1 BONG SAO, BINH DONG WARD, HO CHI MINH CITY, VIETNAM'
WHERE id = 33;

UPDATE booking_partners SET
  address = 'INDUSTRIAL ZONE, AN BINH WARD, GIA LAI PROVINCE, VIETNAM',
  customer_type = 'DIRECT',
  invoice_company_address = 'INDUSTRIAL ZONE, AN BINH WARD, GIA LAI PROVINCE, VIETNAM'
WHERE id = 42;

UPDATE booking_partners SET
  address = '30 CAM BAC 5 STREET, CAM LE WARD, DA NANG CITY, VIETNAM',
  invoice_company_name = 'PHUC THINH AGRICULTURAL MACHINERY COMPANY LIMITED',
  invoice_company_address = '30 CAM BAC 5 STREET, CAM LE WARD, DA NANG CITY, VIETNAM'
WHERE id = 109;

UPDATE booking_partners SET
  address = '6 FL., NO. 3, ALLEY 35, LANE 118, WUXING ST., XINYI DISTRICT, TAIPEI CITY 110, TAIWAN',
  invoice_company_address = '6 FL., NO. 3, ALLEY 35, LANE 118, WUXING ST., XINYI DISTRICT, TAIPEI CITY 110, TAIWAN'
WHERE id = 41;

UPDATE booking_partners SET
  address = 'LOT A10, PHU TAI INDUSTRIAL ZONE, QUY NHON BAC WARD, GIA LAI PROVINCE, VIETNAM',
  invoice_company_name = 'TRUONG HUY CO., LTD',
  invoice_company_address = 'LOT A10, PHU TAI INDUSTRIAL ZONE, QUY NHON BAC WARD, GIA LAI PROVINCE, VIETNAM'
WHERE id = 108;

UPDATE booking_partners SET
  address = 'VITSHOEKSTRAAT 11, 2070 ZWIJNDRECHT, BELGIUM',
  invoice_company_address = 'VITSHOEKSTRAAT 11, 2070 ZWIJNDRECHT, BELGIUM'
WHERE id = 69;

UPDATE booking_partners SET
  country = 'VIETNAM',
  city = 'Ho Chi Minh',
  address = 'NO. 31 TRAN KHAC CHAN, TAN DINH WARD, HO CHI MINH CITY, VIETNAM',
  customer_status = 'WINCLIENT',
  customer_type = 'DIRECT',
  invoice_company_address = 'NO. 31 TRAN KHAC CHAN, TAN DINH WARD, HO CHI MINH CITY, VIETNAM'
WHERE id = 26;

DELETE FROM booking_partners
WHERE id = ANY(ARRAY[83, 50, 97, 64, 43, 80, 68, 25]);
