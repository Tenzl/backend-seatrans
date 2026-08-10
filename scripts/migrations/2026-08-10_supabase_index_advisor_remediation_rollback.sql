-- Run without an explicit transaction: CONCURRENTLY cannot run in a transaction.

DROP INDEX CONCURRENTLY IF EXISTS public.idx_arrival_notice_records_created_by;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_arrival_notice_records_deleted_by;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_arrival_notice_records_updated_by;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_bill_of_lading_records_created_by;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_bill_of_lading_records_deleted_by;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_bill_of_lading_records_updated_by;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_booking_records_created_by;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_booking_records_deleted_by;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_booking_records_updated_by;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_delivery_order_records_created_by;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_delivery_order_records_deleted_by;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_delivery_order_records_updated_by;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_gallery_images_province;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_gallery_images_commodity;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_gallery_images_port;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_inquiry_change_logs_changed_by;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_inquiry_change_logs_inquiry;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_offices_province;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_post_images_post;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_posts_author;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_shipping_agency_inquiries_service_type;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_users_created_by;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_users_role;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_a7b0756a952645be98e42e9efa"
  ON public.chartering_broking_inquiries (laycan_from, laycan_to);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_09db7c1879992530e55b6da595"
  ON public.freight_forwarding_inquiries (shipment_from, shipment_to);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_699e615af7c43266b54c2e1ef8"
  ON public.freight_forwarding_inquiries (loading_port, discharging_port);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_3480833626e43b890571af5a82"
  ON public.total_logistics_inquiries (loading_port, discharging_port);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_662a209046149225a82b2bf32d"
  ON public.total_logistics_inquiries (shipment_from, shipment_to);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_id_created_at
  ON public.notifications (user_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_id_unread
  ON public.notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_provinces_area_code
  ON public.provinces (area);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inquiry_field_change_logs_changed_by
  ON public.shipping_agency_field_change_logs
    (changed_by_user_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inquiry_field_change_logs_inquiry_id
  ON public.shipping_agency_field_change_logs (inquiry_id, created_at DESC);
