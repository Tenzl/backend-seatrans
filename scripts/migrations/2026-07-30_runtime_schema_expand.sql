-- Runtime schema previously created from NestJS OnModuleInit hooks.
-- This expand-only migration is safe for rolling deployment: it creates or
-- adds required objects and never drops legacy tables or business columns.

DO $$
BEGIN
  IF to_regclass('public.users') IS NULL
     OR to_regclass('public.service_types') IS NULL
     OR to_regclass('public.shipping_agency_inquiries') IS NULL THEN
    RAISE EXCEPTION
      'Missing prerequisite tables: users, service_types, shipping_agency_inquiries';
  END IF;
END $$;

CREATE SEQUENCE IF NOT EXISTS inquiry_global_id_seq AS BIGINT;

CREATE TABLE IF NOT EXISTS chartering_broking_inquiries (
  id BIGINT PRIMARY KEY DEFAULT nextval('inquiry_global_id_seq'),
  code VARCHAR(20) UNIQUE,
  service_type_id BIGINT NOT NULL REFERENCES service_types(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  full_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(64),
  company VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'PROCESSING',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_source VARCHAR(32) NOT NULL DEFAULT 'CUSTOMER_PORTAL',
  details JSON,
  deleted_at TIMESTAMP,
  deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  cargo_quantity VARCHAR(255),
  loading_port VARCHAR(255),
  discharging_port VARCHAR(255),
  laycan_from DATE,
  laycan_to DATE,
  other_info TEXT
);

CREATE TABLE IF NOT EXISTS freight_forwarding_inquiries (
  id BIGINT PRIMARY KEY DEFAULT nextval('inquiry_global_id_seq'),
  code VARCHAR(20) UNIQUE,
  service_type_id BIGINT NOT NULL REFERENCES service_types(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  full_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(64),
  company VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'PROCESSING',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_source VARCHAR(32) NOT NULL DEFAULT 'CUSTOMER_PORTAL',
  details JSON,
  deleted_at TIMESTAMP,
  deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  cargo_name VARCHAR(255),
  delivery_term VARCHAR(100),
  container_20ft INTEGER,
  container_40ft INTEGER,
  loading_port VARCHAR(255),
  discharging_port VARCHAR(255),
  shipment_from DATE,
  shipment_to DATE
);

CREATE TABLE IF NOT EXISTS total_logistics_inquiries (
  id BIGINT PRIMARY KEY DEFAULT nextval('inquiry_global_id_seq'),
  code VARCHAR(20) UNIQUE,
  service_type_id BIGINT NOT NULL REFERENCES service_types(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  full_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(64),
  company VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'PROCESSING',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_source VARCHAR(32) NOT NULL DEFAULT 'CUSTOMER_PORTAL',
  details JSON,
  deleted_at TIMESTAMP,
  deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  cargo_name VARCHAR(255),
  delivery_term VARCHAR(100),
  container_20ft INTEGER,
  container_40ft INTEGER,
  loading_port VARCHAR(255),
  discharging_port VARCHAR(255),
  shipment_from DATE,
  shipment_to DATE
);

CREATE TABLE IF NOT EXISTS special_request_inquiries (
  id BIGINT PRIMARY KEY DEFAULT nextval('inquiry_global_id_seq'),
  code VARCHAR(20) UNIQUE,
  service_type_id BIGINT NOT NULL REFERENCES service_types(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  full_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(64),
  company VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'PROCESSING',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_source VARCHAR(32) NOT NULL DEFAULT 'CUSTOMER_PORTAL',
  details JSON,
  deleted_at TIMESTAMP,
  deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  subject VARCHAR(500),
  preferred_province_id BIGINT,
  related_department_id BIGINT,
  message TEXT,
  other_info TEXT
);

-- Existing installations may predate inquiry archive support.
ALTER TABLE chartering_broking_inquiries
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE freight_forwarding_inquiries
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE total_logistics_inquiries
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE special_request_inquiries
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE shipping_agency_inquiries
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_submitted_snapshot JSONB;

ALTER TABLE shipping_agency_inquiries
  ALTER COLUMN id SET DEFAULT nextval('inquiry_global_id_seq');
ALTER TABLE chartering_broking_inquiries
  ALTER COLUMN id SET DEFAULT nextval('inquiry_global_id_seq');
ALTER TABLE freight_forwarding_inquiries
  ALTER COLUMN id SET DEFAULT nextval('inquiry_global_id_seq');
ALTER TABLE total_logistics_inquiries
  ALTER COLUMN id SET DEFAULT nextval('inquiry_global_id_seq');
ALTER TABLE special_request_inquiries
  ALTER COLUMN id SET DEFAULT nextval('inquiry_global_id_seq');

SELECT setval(
  'inquiry_global_id_seq',
  GREATEST(
    (SELECT last_value FROM inquiry_global_id_seq),
    COALESCE((SELECT MAX(id) FROM shipping_agency_inquiries), 0),
    COALESCE((SELECT MAX(id) FROM chartering_broking_inquiries), 0),
    COALESCE((SELECT MAX(id) FROM freight_forwarding_inquiries), 0),
    COALESCE((SELECT MAX(id) FROM total_logistics_inquiries), 0),
    COALESCE((SELECT MAX(id) FROM special_request_inquiries), 0),
    1
  )
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inquiry_id BIGINT,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The audit entity uses this canonical table name. The legacy
-- inquiry_field_change_logs table is intentionally retained for contract later.
CREATE TABLE IF NOT EXISTS shipping_agency_field_change_logs (
  id BIGSERIAL PRIMARY KEY,
  inquiry_id BIGINT NOT NULL
    REFERENCES shipping_agency_inquiries(id) ON DELETE CASCADE,
  changed_by_user_id BIGINT NOT NULL REFERENCES users(id),
  action VARCHAR(32) NOT NULL,
  field_name VARCHAR(64) NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(64) NOT NULL,
  resource_type VARCHAR(96) NOT NULL,
  resource_id VARCHAR(255),
  method VARCHAR(12) NOT NULL,
  request_path VARCHAR(500) NOT NULL,
  status VARCHAR(16) NOT NULL
    CHECK (status IN ('STARTED', 'SUCCEEDED', 'FAILED')),
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shipping_field_logs_inquiry_created
  ON shipping_agency_field_change_logs (inquiry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipping_field_logs_actor_created
  ON shipping_agency_field_change_logs (changed_by_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS booking_partner_field_change_logs (
  id BIGSERIAL PRIMARY KEY,
  partner_id BIGINT NOT NULL
    REFERENCES booking_partners(id) ON DELETE CASCADE,
  changed_by_user_id BIGINT NOT NULL REFERENCES users(id),
  action VARCHAR(32) NOT NULL,
  field_name VARCHAR(64) NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_booking_partner_field_logs_partner_created
  ON booking_partner_field_change_logs (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_partner_field_logs_actor_created
  ON booking_partner_field_change_logs (changed_by_user_id, created_at DESC);

ALTER TABLE booking_partners
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor_created
  ON admin_audit_logs (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_resource_created
  ON admin_audit_logs (resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_status_created
  ON admin_audit_logs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chartering_user_submitted
  ON chartering_broking_inquiries (user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_freight_user_submitted
  ON freight_forwarding_inquiries (user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_total_logistics_user_submitted
  ON total_logistics_inquiries (user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_special_request_user_submitted
  ON special_request_inquiries (user_id, submitted_at DESC);

COMMENT ON TABLE notifications IS
  'In-app notifications; inquiry_id is polymorphic and resolved with metadata.serviceSlug';

-- Booking document history lifecycle (draft / complete / lock / archive).
-- The base table is created by 2026-07-29_booking_document_records; expand only
-- when that table already exists.
DO $$
BEGIN
  IF to_regclass('public.booking_document_records') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE booking_document_records
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED';
  ALTER TABLE booking_document_records
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  ALTER TABLE booking_document_records
    ADD COLUMN IF NOT EXISTS updated_by_user_id INTEGER;
  ALTER TABLE booking_document_records
    ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
  ALTER TABLE booking_document_records
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
  ALTER TABLE booking_document_records
    ADD COLUMN IF NOT EXISTS deleted_by_user_id INTEGER;

  CREATE INDEX IF NOT EXISTS idx_booking_document_records_active_created_at
    ON booking_document_records (created_at DESC, id DESC)
    WHERE deleted_at IS NULL;
END $$;
