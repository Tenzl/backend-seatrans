-- Exact rollback for the ACL/function state captured before
-- 2026-08-10_supabase_data_api_acl_hardening.sql was applied.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

GRANT ALL PRIVILEGES ON TABLE
  public.admin_audit_logs,
  public.app_data_migrations,
  public.app_schema_migrations,
  public.arrival_notice_records,
  public.bill_of_lading_records,
  public.booking_partner_addition_types,
  public.booking_partners,
  public.booking_records,
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
  public.inquiry_idempotency_keys,
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
TO anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_epda_parameter_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_epda_group_member()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_scope VARCHAR(10);
  target_area VARCHAR(50);
  member_area INTEGER;
BEGIN
  SELECT scope, area
  INTO target_scope, target_area
  FROM epda_parameter_set
  WHERE id = NEW.group_id;

  IF target_scope IS DISTINCT FROM 'GROUP' THEN
    RAISE EXCEPTION 'EPDA membership group_id % is not a GROUP parameter set', NEW.group_id;
  END IF;

  SELECT province.area
  INTO member_area
  FROM ports port
  LEFT JOIN provinces province ON province.id = port.province_id
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

GRANT EXECUTE ON FUNCTION public.set_epda_parameter_updated_at()
  TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_epda_group_member()
  TO PUBLIC, anon, authenticated;

COMMIT;
