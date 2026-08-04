-- Irreversible data migration requested for the Booking workflow cutover.
-- Removes all legacy transport-document history and resets its identity.

TRUNCATE TABLE booking_document_records RESTART IDENTITY;
