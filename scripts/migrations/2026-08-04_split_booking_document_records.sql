-- DESTRUCTIVE / DATA-IRREVERSIBLE migration.
--
-- This script intentionally does not backfill booking_document_records. It may
-- only run through scripts/run-booking-document-table-split.mjs, which owns the
-- transaction, database identity check, advisory lock, and confirmation token.
-- The SQL repeats the row-distribution guard so a stale or modified runner
-- cannot silently delete a different data set.

DO $$
DECLARE
  total_count BIGINT;
  booking_count BIGINT;
  an_count BIGINT;
  do_count BIGINT;
  bl_count BIGINT;
BEGIN
  IF to_regclass('public.booking_document_records') IS NULL THEN
    RAISE EXCEPTION 'booking_document_records does not exist';
  END IF;

  IF to_regclass('public.booking_records') IS NOT NULL
    OR to_regclass('public.arrival_notice_records') IS NOT NULL
    OR to_regclass('public.delivery_order_records') IS NOT NULL
    OR to_regclass('public.bill_of_lading_records') IS NOT NULL THEN
    RAISE EXCEPTION 'one or more split booking-document tables already exist';
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE document_type = 'booking'),
    COUNT(*) FILTER (WHERE document_type = 'an'),
    COUNT(*) FILTER (WHERE document_type = 'do'),
    COUNT(*) FILTER (WHERE document_type = 'bl')
  INTO total_count, booking_count, an_count, do_count, bl_count
  FROM booking_document_records;

  IF total_count <> 14
    OR booking_count <> 5
    OR an_count <> 5
    OR do_count <> 2
    OR bl_count <> 2 THEN
    RAISE EXCEPTION
      'destructive guard rejected distribution total=%, booking=%, an=%, do=%, bl=%; expected 14/5/5/2/2',
      total_count, booking_count, an_count, do_count, bl_count;
  END IF;
END $$;

CREATE TABLE booking_records (
  id BIGSERIAL PRIMARY KEY,
  payload JSONB NOT NULL,
  booking_number VARCHAR(200)
    GENERATED ALWAYS AS (payload ->> 'bookingNumber') STORED,
  vessel_voyage VARCHAR(300)
    GENERATED ALWAYS AS (payload ->> 'vesselVoyage') STORED,
  booking_flow VARCHAR(10) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING',
  created_by_user_id INTEGER NOT NULL,
  updated_by_user_id INTEGER,
  deleted_by_user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT ck_booking_records_flow
    CHECK (booking_flow IN ('IMPORT', 'EXPORT')),
  CONSTRAINT ck_booking_records_status
    CHECK (status IN ('PROCESSING', 'COMPLETED')),
  CONSTRAINT fk_booking_records_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_booking_records_updated_by
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_booking_records_deleted_by
    FOREIGN KEY (deleted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE arrival_notice_records (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT,
  payload JSONB NOT NULL,
  an_number VARCHAR(100)
    GENERATED ALWAYS AS (payload ->> 'anNumber') STORED,
  mbl_number VARCHAR(200)
    GENERATED ALWAYS AS (payload ->> 'mblNumber') STORED,
  hbl_number VARCHAR(200)
    GENERATED ALWAYS AS (payload ->> 'hblNumber') STORED,
  shipment_number VARCHAR(200)
    GENERATED ALWAYS AS (payload ->> 'shipmentNumber') STORED,
  reference_number VARCHAR(200)
    GENERATED ALWAYS AS (payload ->> 'referenceNumber') STORED,
  vessel_voyage VARCHAR(300)
    GENERATED ALWAYS AS (payload ->> 'vesselVoyage') STORED,
  status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING',
  created_by_user_id INTEGER NOT NULL,
  updated_by_user_id INTEGER,
  deleted_by_user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT ck_arrival_notice_records_status
    CHECK (status IN ('PROCESSING', 'COMPLETED')),
  CONSTRAINT fk_arrival_notice_records_booking
    FOREIGN KEY (booking_id) REFERENCES booking_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_arrival_notice_records_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_arrival_notice_records_updated_by
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_arrival_notice_records_deleted_by
    FOREIGN KEY (deleted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE delivery_order_records (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT,
  payload JSONB NOT NULL,
  do_number VARCHAR(100)
    GENERATED ALWAYS AS (payload ->> 'doNumber') STORED,
  mbl_number VARCHAR(200)
    GENERATED ALWAYS AS (payload ->> 'mblNumber') STORED,
  hbl_number VARCHAR(200)
    GENERATED ALWAYS AS (payload ->> 'hblNumber') STORED,
  shipment_number VARCHAR(200)
    GENERATED ALWAYS AS (payload ->> 'shipmentNumber') STORED,
  vessel_voyage VARCHAR(300)
    GENERATED ALWAYS AS (payload ->> 'vesselVoyage') STORED,
  status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING',
  created_by_user_id INTEGER NOT NULL,
  updated_by_user_id INTEGER,
  deleted_by_user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT ck_delivery_order_records_status
    CHECK (status IN ('PROCESSING', 'COMPLETED')),
  CONSTRAINT fk_delivery_order_records_booking
    FOREIGN KEY (booking_id) REFERENCES booking_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_delivery_order_records_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_order_records_updated_by
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_delivery_order_records_deleted_by
    FOREIGN KEY (deleted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE bill_of_lading_records (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT,
  payload JSONB NOT NULL,
  fbl_number VARCHAR(100)
    GENERATED ALWAYS AS (payload ->> 'fblNumber') STORED,
  ocean_vessel VARCHAR(300)
    GENERATED ALWAYS AS (payload ->> 'oceanVessel') STORED,
  voyage_number VARCHAR(200)
    GENERATED ALWAYS AS (payload ->> 'voyageNumber') STORED,
  status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING',
  created_by_user_id INTEGER NOT NULL,
  updated_by_user_id INTEGER,
  deleted_by_user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT ck_bill_of_lading_records_status
    CHECK (status IN ('PROCESSING', 'COMPLETED')),
  CONSTRAINT fk_bill_of_lading_records_booking
    FOREIGN KEY (booking_id) REFERENCES booking_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_bill_of_lading_records_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bill_of_lading_records_updated_by
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_bill_of_lading_records_deleted_by
    FOREIGN KEY (deleted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_booking_records_active_created_at
  ON booking_records (created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_booking_records_booking_number
  ON booking_records (booking_number)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_booking_records_vessel_voyage
  ON booking_records (vessel_voyage) WHERE deleted_at IS NULL;

CREATE INDEX idx_arrival_notice_records_active_created_at
  ON arrival_notice_records (created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_arrival_notice_records_booking_id
  ON arrival_notice_records (booking_id, created_at ASC, id ASC)
  WHERE booking_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_arrival_notice_records_active_booking
  ON arrival_notice_records (booking_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_arrival_notice_records_an_number
  ON arrival_notice_records (an_number)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_arrival_notice_records_mbl_number
  ON arrival_notice_records (mbl_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_arrival_notice_records_hbl_number
  ON arrival_notice_records (hbl_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_arrival_notice_records_shipment_number
  ON arrival_notice_records (shipment_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_arrival_notice_records_reference_number
  ON arrival_notice_records (reference_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_arrival_notice_records_vessel_voyage
  ON arrival_notice_records (vessel_voyage) WHERE deleted_at IS NULL;

CREATE INDEX idx_delivery_order_records_active_created_at
  ON delivery_order_records (created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_delivery_order_records_booking_id
  ON delivery_order_records (booking_id, created_at ASC, id ASC)
  WHERE booking_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_delivery_order_records_active_booking
  ON delivery_order_records (booking_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_delivery_order_records_do_number
  ON delivery_order_records (do_number)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_delivery_order_records_mbl_number
  ON delivery_order_records (mbl_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_delivery_order_records_hbl_number
  ON delivery_order_records (hbl_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_delivery_order_records_shipment_number
  ON delivery_order_records (shipment_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_delivery_order_records_vessel_voyage
  ON delivery_order_records (vessel_voyage) WHERE deleted_at IS NULL;

CREATE INDEX idx_bill_of_lading_records_active_created_at
  ON bill_of_lading_records (created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_bill_of_lading_records_booking_id
  ON bill_of_lading_records (booking_id, created_at ASC, id ASC)
  WHERE booking_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_bill_of_lading_records_active_booking
  ON bill_of_lading_records (booking_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_bill_of_lading_records_fbl_number
  ON bill_of_lading_records (fbl_number)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_bill_of_lading_records_ocean_vessel
  ON bill_of_lading_records (ocean_vessel) WHERE deleted_at IS NULL;
CREATE INDEX idx_bill_of_lading_records_voyage_number
  ON bill_of_lading_records (voyage_number) WHERE deleted_at IS NULL;

COMMENT ON COLUMN booking_records.booking_flow IS
  'Root workflow direction: IMPORT or EXPORT.';
COMMENT ON COLUMN booking_records.locked_at IS
  'When set, edits are rejected until explicitly unlocked.';
COMMENT ON COLUMN booking_records.deleted_at IS
  'Soft-archive timestamp; permanent delete removes the row.';
COMMENT ON COLUMN arrival_notice_records.booking_id IS
  'Optional root Booking link; active linked records are unique per booking.';
COMMENT ON COLUMN delivery_order_records.booking_id IS
  'Optional root Booking link; active linked records are unique per booking.';
COMMENT ON COLUMN bill_of_lading_records.booking_id IS
  'Optional root Booking link; active linked records are unique per booking.';

-- Deliberately omit CASCADE. Any unplanned dependency must abort the entire
-- transaction instead of being removed implicitly.
DROP TABLE booking_document_records;

DO $$
DECLARE
  remaining BIGINT;
BEGIN
  IF to_regclass('public.booking_document_records') IS NOT NULL THEN
    RAISE EXCEPTION 'legacy table still exists after split';
  END IF;

  SELECT
    (SELECT COUNT(*) FROM booking_records)
    + (SELECT COUNT(*) FROM arrival_notice_records)
    + (SELECT COUNT(*) FROM delivery_order_records)
    + (SELECT COUNT(*) FROM bill_of_lading_records)
  INTO remaining;

  IF remaining <> 0 THEN
    RAISE EXCEPTION 'split tables must be empty after migration; found % rows', remaining;
  END IF;
END $$;
