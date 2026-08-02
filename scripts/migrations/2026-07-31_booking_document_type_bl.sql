-- Allow Bill of Lading (bl) alongside AN / Booking / DO.
ALTER TABLE booking_document_records
  DROP CONSTRAINT IF EXISTS ck_booking_document_records_type;

ALTER TABLE booking_document_records
  ADD CONSTRAINT ck_booking_document_records_type
  CHECK (document_type IN ('an', 'booking', 'do', 'bl'));
