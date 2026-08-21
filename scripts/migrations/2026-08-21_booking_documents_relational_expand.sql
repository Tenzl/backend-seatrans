-- Booking documents relational model: EXPAND phase only.
--
-- Safety contract:
--   * legacy payload and generated columns remain untouched;
--   * every new column is nullable (except metadata with a constant default);
--   * no existing row is rewritten by this file;
--   * foreign keys on populated parent tables are NOT VALID.

ALTER TABLE public.booking_records
  ADD COLUMN IF NOT EXISTS presentation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS presentation_schema_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS document_number_v2 VARCHAR(200),
  ADD COLUMN IF NOT EXISTS document_date DATE,
  ADD COLUMN IF NOT EXISTS client_party_id INTEGER,
  ADD COLUMN IF NOT EXISTS vessel_voyage_text VARCHAR(300),
  ADD COLUMN IF NOT EXISTS etd DATE,
  ADD COLUMN IF NOT EXISTS eta DATE,
  ADD COLUMN IF NOT EXISTS place_of_receipt_port_id INTEGER,
  ADD COLUMN IF NOT EXISTS port_of_loading_id INTEGER,
  ADD COLUMN IF NOT EXISTS place_of_issue_port_id INTEGER,
  ADD COLUMN IF NOT EXISTS pickup_port_id INTEGER,
  ADD COLUMN IF NOT EXISTS port_of_discharge_id INTEGER,
  ADD COLUMN IF NOT EXISTS place_of_delivery_port_id INTEGER,
  ADD COLUMN IF NOT EXISTS dropoff_port_id INTEGER,
  ADD COLUMN IF NOT EXISTS transit_port_id INTEGER,
  ADD COLUMN IF NOT EXISTS pickup_date DATE,
  ADD COLUMN IF NOT EXISTS closing_time TIMESTAMP WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS si_cutoff TIMESTAMP WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS vgm_cutoff TIMESTAMP WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS commodity_type_id INTEGER,
  ADD COLUMN IF NOT EXISTS commodity_id INTEGER,
  ADD COLUMN IF NOT EXISTS gross_weight_kg NUMERIC(18,3),
  ADD COLUMN IF NOT EXISTS gross_weight_raw TEXT,
  ADD COLUMN IF NOT EXISTS measurement_cbm NUMERIC(18,3),
  ADD COLUMN IF NOT EXISTS measurement_raw TEXT,
  ADD COLUMN IF NOT EXISTS mother_vessel VARCHAR(200),
  ADD COLUMN IF NOT EXISTS mother_voyage VARCHAR(200),
  ADD COLUMN IF NOT EXISTS pic_user_id INTEGER;

ALTER TABLE public.arrival_notice_records
  ADD COLUMN IF NOT EXISTS presentation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS presentation_schema_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS document_number_v2 VARCHAR(100),
  ADD COLUMN IF NOT EXISTS document_date DATE,
  ADD COLUMN IF NOT EXISTS agent_party_id INTEGER,
  ADD COLUMN IF NOT EXISTS shipper_party_id INTEGER,
  ADD COLUMN IF NOT EXISTS consignee_party_id INTEGER,
  ADD COLUMN IF NOT EXISTS notify_party_id INTEGER,
  ADD COLUMN IF NOT EXISTS master_bill_number_v2 VARCHAR(200),
  ADD COLUMN IF NOT EXISTS house_bill_number_v2 VARCHAR(200),
  ADD COLUMN IF NOT EXISTS shipment_number_v2 VARCHAR(200),
  ADD COLUMN IF NOT EXISTS reference_number_v2 VARCHAR(200),
  ADD COLUMN IF NOT EXISTS vessel_voyage_text VARCHAR(300),
  ADD COLUMN IF NOT EXISTS etd DATE,
  ADD COLUMN IF NOT EXISTS eta DATE,
  ADD COLUMN IF NOT EXISTS place_of_receipt_port_id INTEGER,
  ADD COLUMN IF NOT EXISTS port_of_loading_id INTEGER,
  ADD COLUMN IF NOT EXISTS port_of_discharge_id INTEGER,
  ADD COLUMN IF NOT EXISTS place_of_delivery_port_id INTEGER,
  ADD COLUMN IF NOT EXISTS final_destination_port_id INTEGER,
  ADD COLUMN IF NOT EXISTS service_mode VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cfs_terminal VARCHAR(300),
  ADD COLUMN IF NOT EXISTS commodity_type_id INTEGER,
  ADD COLUMN IF NOT EXISTS commodity_id INTEGER;

ALTER TABLE public.delivery_order_records
  ADD COLUMN IF NOT EXISTS presentation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS presentation_schema_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS document_number_v2 VARCHAR(100),
  ADD COLUMN IF NOT EXISTS document_date DATE,
  ADD COLUMN IF NOT EXISTS consignee_party_id INTEGER,
  ADD COLUMN IF NOT EXISTS notify_party_id INTEGER,
  ADD COLUMN IF NOT EXISTS master_bill_number_v2 VARCHAR(200),
  ADD COLUMN IF NOT EXISTS house_bill_number_v2 VARCHAR(200),
  ADD COLUMN IF NOT EXISTS shipment_number_v2 VARCHAR(200),
  ADD COLUMN IF NOT EXISTS vessel_voyage_text VARCHAR(300),
  ADD COLUMN IF NOT EXISTS etd DATE,
  ADD COLUMN IF NOT EXISTS eta DATE,
  ADD COLUMN IF NOT EXISTS place_of_receipt_port_id INTEGER,
  ADD COLUMN IF NOT EXISTS port_of_loading_id INTEGER,
  ADD COLUMN IF NOT EXISTS port_of_discharge_id INTEGER,
  ADD COLUMN IF NOT EXISTS place_of_delivery_port_id INTEGER,
  ADD COLUMN IF NOT EXISTS final_destination_port_id INTEGER,
  ADD COLUMN IF NOT EXISTS service_mode VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cfs_terminal VARCHAR(300);

ALTER TABLE public.bill_of_lading_records
  ADD COLUMN IF NOT EXISTS presentation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS presentation_schema_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS document_number_v2 VARCHAR(100),
  ADD COLUMN IF NOT EXISTS document_date DATE,
  ADD COLUMN IF NOT EXISTS shipper_party_id INTEGER,
  ADD COLUMN IF NOT EXISTS consignee_party_id INTEGER,
  ADD COLUMN IF NOT EXISTS notify_party_id INTEGER,
  ADD COLUMN IF NOT EXISTS place_of_receipt_port_id INTEGER,
  ADD COLUMN IF NOT EXISTS port_of_loading_id INTEGER,
  ADD COLUMN IF NOT EXISTS port_of_discharge_id INTEGER,
  ADD COLUMN IF NOT EXISTS place_of_delivery_port_id INTEGER,
  ADD COLUMN IF NOT EXISTS place_of_issue_port_id INTEGER,
  ADD COLUMN IF NOT EXISTS ocean_vessel_text VARCHAR(300),
  ADD COLUMN IF NOT EXISTS service_mode VARCHAR(100),
  ADD COLUMN IF NOT EXISTS gross_weight_kg NUMERIC(18,3),
  ADD COLUMN IF NOT EXISTS gross_weight_raw TEXT,
  ADD COLUMN IF NOT EXISTS measurement_cbm NUMERIC(18,3),
  ADD COLUMN IF NOT EXISTS measurement_raw TEXT,
  ADD COLUMN IF NOT EXISTS freight_terms VARCHAR(100),
  ADD COLUMN IF NOT EXISTS clean_on_board_date DATE,
  ADD COLUMN IF NOT EXISTS freight_amount NUMERIC(18,3),
  ADD COLUMN IF NOT EXISTS freight_amount_raw TEXT,
  ADD COLUMN IF NOT EXISTS freight_payable_at VARCHAR(300);

DO $migration$
DECLARE spec RECORD;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('booking_records','client_party_id','booking_partners','fk_booking_records_client_party'),
    ('booking_records','commodity_type_id','commodity_types','fk_booking_records_commodity_type'),
    ('booking_records','commodity_id','commodities','fk_booking_records_commodity'),
    ('booking_records','pic_user_id','users','fk_booking_records_pic_user'),
    ('booking_records','place_of_receipt_port_id','ports','fk_booking_records_receipt_port'),
    ('booking_records','port_of_loading_id','ports','fk_booking_records_loading_port'),
    ('booking_records','port_of_discharge_id','ports','fk_booking_records_discharge_port'),
    ('booking_records','place_of_delivery_port_id','ports','fk_booking_records_delivery_port'),
    ('booking_records','place_of_issue_port_id','ports','fk_booking_records_issue_port'),
    ('booking_records','pickup_port_id','ports','fk_booking_records_pickup_port'),
    ('booking_records','dropoff_port_id','ports','fk_booking_records_dropoff_port'),
    ('booking_records','transit_port_id','ports','fk_booking_records_transit_port'),
    ('arrival_notice_records','agent_party_id','booking_partners','fk_an_records_agent_party'),
    ('arrival_notice_records','shipper_party_id','booking_partners','fk_an_records_shipper_party'),
    ('arrival_notice_records','consignee_party_id','booking_partners','fk_an_records_consignee_party'),
    ('arrival_notice_records','notify_party_id','booking_partners','fk_an_records_notify_party'),
    ('arrival_notice_records','place_of_receipt_port_id','ports','fk_an_records_receipt_port'),
    ('arrival_notice_records','port_of_loading_id','ports','fk_an_records_loading_port'),
    ('arrival_notice_records','port_of_discharge_id','ports','fk_an_records_discharge_port'),
    ('arrival_notice_records','place_of_delivery_port_id','ports','fk_an_records_delivery_port'),
    ('arrival_notice_records','final_destination_port_id','ports','fk_an_records_final_port'),
    ('delivery_order_records','consignee_party_id','booking_partners','fk_do_records_consignee_party'),
    ('delivery_order_records','notify_party_id','booking_partners','fk_do_records_notify_party'),
    ('delivery_order_records','place_of_receipt_port_id','ports','fk_do_records_receipt_port'),
    ('delivery_order_records','port_of_loading_id','ports','fk_do_records_loading_port'),
    ('delivery_order_records','port_of_discharge_id','ports','fk_do_records_discharge_port'),
    ('delivery_order_records','place_of_delivery_port_id','ports','fk_do_records_delivery_port'),
    ('delivery_order_records','final_destination_port_id','ports','fk_do_records_final_port'),
    ('bill_of_lading_records','shipper_party_id','booking_partners','fk_bl_records_shipper_party'),
    ('bill_of_lading_records','consignee_party_id','booking_partners','fk_bl_records_consignee_party'),
    ('bill_of_lading_records','notify_party_id','booking_partners','fk_bl_records_notify_party'),
    ('bill_of_lading_records','place_of_receipt_port_id','ports','fk_bl_records_receipt_port'),
    ('bill_of_lading_records','port_of_loading_id','ports','fk_bl_records_loading_port'),
    ('bill_of_lading_records','port_of_discharge_id','ports','fk_bl_records_discharge_port'),
    ('bill_of_lading_records','place_of_delivery_port_id','ports','fk_bl_records_delivery_port'),
    ('bill_of_lading_records','place_of_issue_port_id','ports','fk_bl_records_issue_port')
  ) AS desired(source_table, source_column, target_table, constraint_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = spec.constraint_name) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(id) ON DELETE SET NULL NOT VALID',
        spec.source_table, spec.constraint_name, spec.source_column, spec.target_table
      );
    END IF;
  END LOOP;
END $migration$;

CREATE TABLE IF NOT EXISTS public.booking_cargo_volumes (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL REFERENCES public.booking_records(id) ON DELETE CASCADE,
  row_order INTEGER NOT NULL CHECK (row_order >= 0),
  container_type_code VARCHAR(50) NOT NULL CHECK (BTRIM(container_type_code) <> ''),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE (booking_id, row_order),
  UNIQUE (booking_id, container_type_code)
);

CREATE TABLE IF NOT EXISTS public.bill_of_lading_containers (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES public.bill_of_lading_records(id) ON DELETE CASCADE,
  row_order INTEGER NOT NULL CHECK (row_order >= 0),
  container_type_code VARCHAR(50), container_no VARCHAR(100), seal_no VARCHAR(100),
  gross_weight_kg NUMERIC(18,3), gross_weight_raw TEXT,
  measurement_cbm NUMERIC(18,3), measurement_raw TEXT,
  tare_kg NUMERIC(18,3), tare_raw TEXT,
  package_type_id INTEGER REFERENCES public.commodity_types(id) ON DELETE SET NULL,
  package_type_snapshot VARCHAR(200), number_of_packages INTEGER,
  number_of_packages_raw TEXT, method VARCHAR(100),
  presentation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (document_id, row_order)
);

CREATE TABLE IF NOT EXISTS public.arrival_notice_containers (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES public.arrival_notice_records(id) ON DELETE CASCADE,
  row_order INTEGER NOT NULL CHECK (row_order >= 0),
  container_type_code VARCHAR(50), container_no VARCHAR(100), seal_no VARCHAR(100),
  gross_weight_kg NUMERIC(18,3), gross_weight_raw TEXT,
  measurement_cbm NUMERIC(18,3), measurement_raw TEXT,
  tare_kg NUMERIC(18,3), tare_raw TEXT,
  package_type_id INTEGER REFERENCES public.commodity_types(id) ON DELETE SET NULL,
  package_type_snapshot VARCHAR(200), number_of_packages INTEGER,
  number_of_packages_raw TEXT, method VARCHAR(100),
  presentation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (document_id, row_order)
);

CREATE TABLE IF NOT EXISTS public.delivery_order_containers (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES public.delivery_order_records(id) ON DELETE CASCADE,
  row_order INTEGER NOT NULL CHECK (row_order >= 0),
  container_type_code VARCHAR(50), container_no VARCHAR(100), seal_no VARCHAR(100),
  gross_weight_kg NUMERIC(18,3), gross_weight_raw TEXT,
  measurement_cbm NUMERIC(18,3), measurement_raw TEXT,
  tare_kg NUMERIC(18,3), tare_raw TEXT,
  package_type_id INTEGER REFERENCES public.commodity_types(id) ON DELETE SET NULL,
  package_type_snapshot VARCHAR(200), number_of_packages INTEGER,
  number_of_packages_raw TEXT, method VARCHAR(100),
  presentation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (document_id, row_order)
);

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_records_report_date
  ON public.booking_records (document_date DESC, id DESC) WHERE deleted_at IS NULL;
-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_records_report_dimensions
  ON public.booking_records (booking_flow, client_party_id, port_of_loading_id, port_of_discharge_id)
  WHERE deleted_at IS NULL;
-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_cargo_volumes_booking
  ON public.booking_cargo_volumes (booking_id, row_order);
-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bl_containers_document
  ON public.bill_of_lading_containers (document_id, row_order);
-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_an_containers_document
  ON public.arrival_notice_containers (document_id, row_order);
-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_do_containers_document
  ON public.delivery_order_containers (document_id, row_order);
