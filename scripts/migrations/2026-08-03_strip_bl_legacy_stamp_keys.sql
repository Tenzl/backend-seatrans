-- Strip legacy BL stamp toggle keys from stored JSONB payloads.
-- Run once against the booking documents database.

UPDATE booking_document_records
SET payload = payload - 'showSurrendered' - 'includeCompanyStamp'
WHERE document_type = 'bl'
  AND (
    payload ? 'showSurrendered'
    OR payload ? 'includeCompanyStamp'
  );
