-- Tug assistance: 1 trip (in|out) or 2 trips (in & out). Default existing rows to 2.
ALTER TABLE shipping_agency_inquiries
  ADD COLUMN IF NOT EXISTS tug_assistance_trips smallint;

UPDATE shipping_agency_inquiries
SET tug_assistance_trips = 2
WHERE tug_assistance_trips IS NULL;
