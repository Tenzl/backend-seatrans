-- Read model: exactly one row per active Booking.
CREATE OR REPLACE VIEW public.booking_reporting_v1 AS
WITH planned AS (
  SELECT booking_id,
         SUM(quantity)::bigint AS planned_container_count,
         jsonb_object_agg(container_type_code, quantity ORDER BY row_order) AS planned_container_types
    FROM public.booking_cargo_volumes
   GROUP BY booking_id
),
bl_actual AS (
  SELECT bl.booking_id,
         COUNT(container.id)::bigint AS container_count,
         COALESCE(SUM(container.gross_weight_kg), 0)::numeric(18,3) AS gross_weight_kg,
         COALESCE(SUM(container.measurement_cbm), 0)::numeric(18,3) AS measurement_cbm
    FROM public.bill_of_lading_records bl
    LEFT JOIN public.bill_of_lading_containers container ON container.document_id = bl.id
   WHERE bl.deleted_at IS NULL
   GROUP BY bl.booking_id
),
an_actual AS (
  SELECT notice.booking_id,
         COUNT(container.id)::bigint AS container_count,
         COALESCE(SUM(container.gross_weight_kg), 0)::numeric(18,3) AS gross_weight_kg,
         COALESCE(SUM(container.measurement_cbm), 0)::numeric(18,3) AS measurement_cbm
    FROM public.arrival_notice_records notice
    LEFT JOIN public.arrival_notice_containers container ON container.document_id = notice.id
   WHERE notice.deleted_at IS NULL
   GROUP BY notice.booking_id
),
document_state AS (
  SELECT booking.id AS booking_id,
         EXISTS (SELECT 1 FROM public.bill_of_lading_records bl WHERE bl.booking_id=booking.id AND bl.deleted_at IS NULL) AS has_bl,
         EXISTS (SELECT 1 FROM public.arrival_notice_records notice WHERE notice.booking_id=booking.id AND notice.deleted_at IS NULL) AS has_an,
         EXISTS (SELECT 1 FROM public.delivery_order_records delivery WHERE delivery.booking_id=booking.id AND delivery.deleted_at IS NULL) AS has_do
    FROM public.booking_records booking
   WHERE booking.deleted_at IS NULL
),
bl_document AS (
  SELECT booking_id, id AS bl_id, status AS bl_status, document_date AS bl_date
    FROM public.bill_of_lading_records WHERE deleted_at IS NULL
),
an_document AS (
  SELECT booking_id, id AS an_id, status AS an_status, document_date AS an_date
    FROM public.arrival_notice_records WHERE deleted_at IS NULL
),
do_document AS (
  SELECT booking_id, id AS do_id, status AS do_status, document_date AS do_date
    FROM public.delivery_order_records WHERE deleted_at IS NULL
)
SELECT booking.id AS booking_id,
       booking.booking_flow,
       COALESCE(booking.document_number_v2, booking.booking_number) AS booking_number,
       COALESCE(booking.document_date, booking.created_at::date) AS booking_date,
       booking.status AS booking_status,
       booking.client_party_id,
       partner.name AS client_name,
       booking.port_of_loading_id,
       loading_port.name AS port_of_loading_name,
       booking.port_of_discharge_id,
       discharge_port.name AS port_of_discharge_name,
       booking.commodity_type_id,
       commodity_type.name AS commodity_type_name,
       booking.commodity_id,
       commodity.name AS commodity_name,
       COALESCE(booking.vessel_voyage_text, booking.vessel_voyage) AS vessel_voyage,
       COALESCE(planned.planned_container_count, 0) AS planned_container_count,
       COALESCE(planned.planned_container_types, '{}'::jsonb) AS planned_container_types,
       booking.gross_weight_kg AS planned_gross_weight_kg,
       booking.measurement_cbm AS planned_measurement_cbm,
       CASE WHEN booking.booking_flow='IMPORT'
            THEN COALESCE(an_actual.container_count, 0)
            ELSE COALESCE(bl_actual.container_count, 0) END AS actual_container_count,
       CASE WHEN booking.booking_flow='IMPORT'
            THEN COALESCE(an_actual.gross_weight_kg, 0)
            ELSE COALESCE(bl_actual.gross_weight_kg, 0) END AS actual_gross_weight_kg,
       CASE WHEN booking.booking_flow='IMPORT'
            THEN COALESCE(an_actual.measurement_cbm, 0)
            ELSE COALESCE(bl_actual.measurement_cbm, 0) END AS actual_measurement_cbm,
       document_state.has_bl, document_state.has_an, document_state.has_do,
       bl_document.bl_id, bl_document.bl_status, bl_document.bl_date,
       an_document.an_id, an_document.an_status, an_document.an_date,
       do_document.do_id, do_document.do_status, do_document.do_date,
       booking.created_at, booking.updated_at
  FROM public.booking_records booking
  LEFT JOIN planned ON planned.booking_id=booking.id
  LEFT JOIN bl_actual ON bl_actual.booking_id=booking.id
  LEFT JOIN an_actual ON an_actual.booking_id=booking.id
  JOIN document_state ON document_state.booking_id=booking.id
  LEFT JOIN bl_document ON bl_document.booking_id=booking.id
  LEFT JOIN an_document ON an_document.booking_id=booking.id
  LEFT JOIN do_document ON do_document.booking_id=booking.id
  LEFT JOIN public.booking_partners partner ON partner.id=booking.client_party_id
  LEFT JOIN public.ports loading_port ON loading_port.id=booking.port_of_loading_id
  LEFT JOIN public.ports discharge_port ON discharge_port.id=booking.port_of_discharge_id
  LEFT JOIN public.commodity_types commodity_type ON commodity_type.id=booking.commodity_type_id
  LEFT JOIN public.commodities commodity ON commodity.id=booking.commodity_id
 WHERE booking.deleted_at IS NULL;
