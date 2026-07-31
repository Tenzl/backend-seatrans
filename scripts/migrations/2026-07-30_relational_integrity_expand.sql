-- Expand-only relational integrity migration.
--
-- Foreign keys are added NOT VALID so existing production rows are not
-- scanned while the constraint lock is held. New writes are still enforced.
-- A later, separately approved validation migration may validate them.
--
-- Indexes are built concurrently and therefore this script must be executed
-- statement-by-statement, outside an explicit transaction.

DO $migration$
DECLARE
  spec RECORD;
  source_relation REGCLASS;
  target_relation REGCLASS;
BEGIN
  FOR spec IN
    SELECT *
    FROM (
      VALUES
        ('booking_document_records', 'created_by_user_id', 'users', 'RESTRICT', 'fk_booking_document_records_created_by_users'),

        ('freight_forwarding_inquiries', 'user_id', 'users', 'NO ACTION', 'fk_freight_forwarding_inquiries_user_users'),
        ('freight_forwarding_inquiries', 'processed_by', 'users', 'NO ACTION', 'fk_freight_forwarding_inquiries_processed_users'),
        ('freight_forwarding_inquiries', 'deleted_by', 'users', 'SET NULL', 'fk_freight_forwarding_inquiries_deleted_users'),

        ('special_request_inquiries', 'user_id', 'users', 'NO ACTION', 'fk_special_request_inquiries_user_users'),
        ('special_request_inquiries', 'processed_by', 'users', 'NO ACTION', 'fk_special_request_inquiries_processed_users'),
        ('special_request_inquiries', 'deleted_by', 'users', 'SET NULL', 'fk_special_request_inquiries_deleted_users'),

        ('shipping_agency_inquiries', 'user_id', 'users', 'NO ACTION', 'fk_shipping_agency_inquiries_user_users'),
        ('shipping_agency_inquiries', 'processed_by', 'users', 'NO ACTION', 'fk_shipping_agency_inquiries_processed_users'),
        ('shipping_agency_inquiries', 'deleted_by', 'users', 'SET NULL', 'fk_shipping_agency_inquiries_deleted_users'),
        ('shipping_agency_inquiries', 'quoted_by_user_id', 'users', 'NO ACTION', 'fk_shipping_agency_inquiries_quoted_users'),
        ('shipping_agency_inquiries', 'port_id', 'ports', 'SET NULL', 'fk_shipping_agency_inquiries_port_ports'),

        ('chartering_broking_inquiries', 'user_id', 'users', 'NO ACTION', 'fk_chartering_broking_inquiries_user_users'),
        ('chartering_broking_inquiries', 'processed_by', 'users', 'NO ACTION', 'fk_chartering_broking_inquiries_processed_users'),
        ('chartering_broking_inquiries', 'deleted_by', 'users', 'SET NULL', 'fk_chartering_broking_inquiries_deleted_users'),

        ('total_logistics_inquiries', 'user_id', 'users', 'NO ACTION', 'fk_total_logistics_inquiries_user_users'),
        ('total_logistics_inquiries', 'processed_by', 'users', 'NO ACTION', 'fk_total_logistics_inquiries_processed_users'),
        ('total_logistics_inquiries', 'deleted_by', 'users', 'SET NULL', 'fk_total_logistics_inquiries_deleted_users'),

        ('inquiry_documents', 'uploaded_by', 'users', 'NO ACTION', 'fk_inquiry_documents_uploaded_by_users'),

        ('booking_shipping', 'booking_partner_id', 'booking_partners', 'NO ACTION', 'fk_booking_shipping_partner'),
        ('booking_shipping', 'place_of_receipt_port_id', 'ports', 'NO ACTION', 'fk_booking_shipping_receipt_port'),
        ('booking_shipping', 'port_of_loading_port_id', 'ports', 'NO ACTION', 'fk_booking_shipping_loading_port'),
        ('booking_shipping', 'port_of_discharge_port_id', 'ports', 'NO ACTION', 'fk_booking_shipping_discharge_port'),
        ('booking_shipping', 'place_of_delivery_port_id', 'ports', 'NO ACTION', 'fk_booking_shipping_delivery_port'),
        ('booking_shipping', 'final_destination_port_id', 'ports', 'NO ACTION', 'fk_booking_shipping_destination_port'),

        ('booking_transit_ports', 'booking_shipping_id', 'booking_shipping', 'CASCADE', 'fk_booking_transit_ports_shipping'),
        ('booking_transit_ports', 'port_id', 'ports', 'NO ACTION', 'fk_booking_transit_ports_port')
    ) AS desired(
      source_table,
      source_column,
      target_table,
      delete_action,
      constraint_name
    )
  LOOP
    source_relation := to_regclass('public.' || spec.source_table);
    target_relation := to_regclass('public.' || spec.target_table);

    IF source_relation IS NULL THEN
      RAISE EXCEPTION 'Required source table is missing: %', spec.source_table;
    END IF;
    IF target_relation IS NULL THEN
      RAISE EXCEPTION 'Required target table is missing: %', spec.target_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_attribute attribute
      WHERE attribute.attrelid = source_relation
        AND attribute.attname = spec.source_column
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    ) THEN
      RAISE EXCEPTION 'Required source column is missing: %.%',
        spec.source_table, spec.source_column;
    END IF;

    -- Do not add a duplicate merely because an existing FK has a generated
    -- name. Match the source column and referenced table semantically.
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint constraint_info
      JOIN pg_attribute source_attribute
        ON source_attribute.attrelid = constraint_info.conrelid
       AND source_attribute.attnum = constraint_info.conkey[1]
      WHERE constraint_info.contype = 'f'
        AND constraint_info.conrelid = source_relation
        AND constraint_info.confrelid = target_relation
        AND cardinality(constraint_info.conkey) = 1
        AND source_attribute.attname = spec.source_column
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE %s NOT VALID',
        spec.source_table,
        spec.constraint_name,
        spec.source_column,
        spec.target_table,
        spec.delete_action
      );
    END IF;
  END LOOP;
END
$migration$;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_document_records_creator_history
  ON booking_document_records (created_by_user_id, created_at DESC, id DESC);

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_freight_forwarding_inquiries_status_active
  ON freight_forwarding_inquiries (status, submitted_at DESC)
  WHERE deleted_at IS NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_freight_forwarding_inquiries_processed
  ON freight_forwarding_inquiries (processed_by, updated_at DESC)
  WHERE processed_by IS NOT NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_freight_forwarding_inquiries_deleted
  ON freight_forwarding_inquiries (deleted_by, deleted_at DESC)
  WHERE deleted_by IS NOT NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_special_request_inquiries_status_active
  ON special_request_inquiries (status, submitted_at DESC)
  WHERE deleted_at IS NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_special_request_inquiries_processed
  ON special_request_inquiries (processed_by, updated_at DESC)
  WHERE processed_by IS NOT NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_special_request_inquiries_deleted
  ON special_request_inquiries (deleted_by, deleted_at DESC)
  WHERE deleted_by IS NOT NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shipping_agency_inquiries_user_active
  ON shipping_agency_inquiries (user_id, submitted_at DESC)
  WHERE deleted_at IS NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shipping_agency_inquiries_status_active
  ON shipping_agency_inquiries (status, submitted_at DESC)
  WHERE deleted_at IS NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shipping_agency_inquiries_processed
  ON shipping_agency_inquiries (processed_by, updated_at DESC)
  WHERE processed_by IS NOT NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shipping_agency_inquiries_deleted
  ON shipping_agency_inquiries (deleted_by, deleted_at DESC)
  WHERE deleted_by IS NOT NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shipping_agency_inquiries_quoted
  ON shipping_agency_inquiries (quoted_by_user_id, quoted_at DESC)
  WHERE quoted_by_user_id IS NOT NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chartering_broking_inquiries_status_active
  ON chartering_broking_inquiries (status, submitted_at DESC)
  WHERE deleted_at IS NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chartering_broking_inquiries_processed
  ON chartering_broking_inquiries (processed_by, updated_at DESC)
  WHERE processed_by IS NOT NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chartering_broking_inquiries_deleted
  ON chartering_broking_inquiries (deleted_by, deleted_at DESC)
  WHERE deleted_by IS NOT NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_total_logistics_inquiries_status_active
  ON total_logistics_inquiries (status, submitted_at DESC)
  WHERE deleted_at IS NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_total_logistics_inquiries_processed
  ON total_logistics_inquiries (processed_by, updated_at DESC)
  WHERE processed_by IS NOT NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_total_logistics_inquiries_deleted
  ON total_logistics_inquiries (deleted_by, deleted_at DESC)
  WHERE deleted_by IS NOT NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inquiry_documents_uploader_history
  ON inquiry_documents (uploaded_by, uploaded_at DESC);

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inquiry_documents_active_target
  ON inquiry_documents (service_slug, target_id, uploaded_at DESC)
  WHERE is_active = TRUE;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inquiry_documents_active_target_type
  ON inquiry_documents (service_slug, target_id, document_type, uploaded_at DESC)
  WHERE is_active = TRUE;

-- statement-break
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_booking_shipping_partner
  ON booking_shipping (booking_partner_id);

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_shipping_receipt_port
  ON booking_shipping (place_of_receipt_port_id)
  WHERE place_of_receipt_port_id IS NOT NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_shipping_loading_port
  ON booking_shipping (port_of_loading_port_id)
  WHERE port_of_loading_port_id IS NOT NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_shipping_discharge_port
  ON booking_shipping (port_of_discharge_port_id)
  WHERE port_of_discharge_port_id IS NOT NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_shipping_delivery_port
  ON booking_shipping (place_of_delivery_port_id)
  WHERE place_of_delivery_port_id IS NOT NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_shipping_destination_port
  ON booking_shipping (final_destination_port_id)
  WHERE final_destination_port_id IS NOT NULL;

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_transit_ports_shipping_order
  ON booking_transit_ports (booking_shipping_id, sort_order, id);

-- statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_transit_ports_port
  ON booking_transit_ports (port_id);
