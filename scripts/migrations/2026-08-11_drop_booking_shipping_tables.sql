-- Drop unused booking shipping tables (never used by backend2.0 runtime).
-- Ports for booking docs live in document JSON payloads instead.
-- Safe to re-run. Drop child first (FK → booking_shipping).

DROP TABLE IF EXISTS booking_transit_ports;
DROP TABLE IF EXISTS booking_shipping;
