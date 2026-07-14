-- Garbage CBM is always 1; remove per-inquiry override column.
ALTER TABLE shipping_agency_inquiries
  DROP COLUMN IF EXISTS garbage_cbm_amount;
