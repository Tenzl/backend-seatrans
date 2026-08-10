-- Backend-only Supabase hardening.
-- The application uses NestJS/TypeORM through DB_URL and does not use PostgREST.
-- Keep this migration transactional. Do not add CREATE/DROP INDEX CONCURRENTLY.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

REVOKE ALL PRIVILEGES ON TABLE
  public.admin_audit_logs,
  public.app_data_migrations,
  public.app_schema_migrations,
  public.arrival_notice_records,
  public.bill_of_lading_records,
  public.booking_partner_addition_types,
  public.booking_partner_field_change_logs,
  public.booking_partners,
  public.booking_records,
  public.booking_shipping,
  public.booking_transit_ports,
  public.cargo_types,
  public.categories,
  public.chartering_broking_inquiries,
  public.commodities,
  public.commodity_groups,
  public.customer_id_sequences,
  public.delivery_order_records,
  public.epda_parameter_change_logs,
  public.epda_parameter_group_members,
  public.epda_parameter_set,
  public.freight_forwarding_inquiries,
  public.gallery_images,
  public.inquiry_documents,
  public.inquiry_field_change_logs,
  public.inquiry_idempotency_keys,
  public.migrations,
  public.notifications,
  public.offices,
  public.ports,
  public.post_categories,
  public.post_images,
  public.posts,
  public.provinces,
  public.role_section_access,
  public.roles,
  public.service_types,
  public.shipping_agency_field_change_logs,
  public.shipping_agency_inquiries,
  public.special_request_inquiries,
  public.total_logistics_inquiries,
  public.users
FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_epda_parameter_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_epda_group_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  target_scope VARCHAR(10);
  target_area VARCHAR(50);
  member_area INTEGER;
BEGIN
  SELECT scope, area
  INTO target_scope, target_area
  FROM public.epda_parameter_set
  WHERE id = NEW.group_id;

  IF target_scope IS DISTINCT FROM 'GROUP' THEN
    RAISE EXCEPTION 'EPDA membership group_id % is not a GROUP parameter set', NEW.group_id;
  END IF;

  SELECT province.area
  INTO member_area
  FROM public.ports AS port
  LEFT JOIN public.provinces AS province ON province.id = port.province_id
  WHERE port.id = NEW.port_id;

  IF member_area IS NULL OR target_area IS DISTINCT FROM member_area::text THEN
    RAISE EXCEPTION
      'EPDA membership port % area % does not match group % area %',
      NEW.port_id,
      member_area,
      NEW.group_id,
      target_area;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_epda_parameter_updated_at()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_epda_group_member()
  FROM PUBLIC, anon, authenticated;

COMMIT;
