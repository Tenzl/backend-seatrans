-- Run without an explicit transaction: CONCURRENTLY cannot run in a transaction.
-- Every dropped index was catalog-verified as valid, non-unique,
-- non-primary, not constraint-backed, and byte-for-byte duplicated by a retained index.

DROP INDEX CONCURRENTLY IF EXISTS public."IDX_a7b0756a952645be98e42e9efa";
DROP INDEX CONCURRENTLY IF EXISTS public."IDX_09db7c1879992530e55b6da595";
DROP INDEX CONCURRENTLY IF EXISTS public."IDX_699e615af7c43266b54c2e1ef8";
DROP INDEX CONCURRENTLY IF EXISTS public."IDX_3480833626e43b890571af5a82";
DROP INDEX CONCURRENTLY IF EXISTS public."IDX_662a209046149225a82b2bf32d";
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notifications_user_id_created_at;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notifications_user_id_unread;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_provinces_area_code;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_inquiry_field_change_logs_changed_by;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_inquiry_field_change_logs_inquiry_id;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_arrival_notice_records_created_by
  ON public.arrival_notice_records (created_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_arrival_notice_records_deleted_by
  ON public.arrival_notice_records (deleted_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_arrival_notice_records_updated_by
  ON public.arrival_notice_records (updated_by_user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bill_of_lading_records_created_by
  ON public.bill_of_lading_records (created_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bill_of_lading_records_deleted_by
  ON public.bill_of_lading_records (deleted_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bill_of_lading_records_updated_by
  ON public.bill_of_lading_records (updated_by_user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_records_created_by
  ON public.booking_records (created_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_records_deleted_by
  ON public.booking_records (deleted_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_records_updated_by
  ON public.booking_records (updated_by_user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_delivery_order_records_created_by
  ON public.delivery_order_records (created_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_delivery_order_records_deleted_by
  ON public.delivery_order_records (deleted_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_delivery_order_records_updated_by
  ON public.delivery_order_records (updated_by_user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gallery_images_province
  ON public.gallery_images (province_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gallery_images_commodity
  ON public.gallery_images (commodity_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gallery_images_port
  ON public.gallery_images (port_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inquiry_change_logs_changed_by
  ON public.inquiry_field_change_logs (changed_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inquiry_change_logs_inquiry
  ON public.inquiry_field_change_logs (inquiry_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_offices_province
  ON public.offices (province_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_post_images_post
  ON public.post_images (post_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_author
  ON public.posts (author_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shipping_agency_inquiries_service_type
  ON public.shipping_agency_inquiries (service_type_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_by
  ON public.users (created_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_role
  ON public.users (role_id);
