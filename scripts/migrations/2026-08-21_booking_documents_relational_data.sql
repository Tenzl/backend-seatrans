-- Booking documents relational model: DATA phase.
-- Run only after the expand migration and a verified pg_dump.

-- Resolve every distinct legacy snapshot once. Building indexed temporary
-- aliases avoids rescanning the full ports catalogue for every document row.
CREATE TEMP TABLE booking_port_aliases (
  alias_key TEXT NOT NULL,
  port_id INTEGER NOT NULL
) ON COMMIT DROP;

INSERT INTO booking_port_aliases (alias_key, port_id)
SELECT DISTINCT UPPER(BTRIM(alias.value)), port.id::integer
  FROM public.ports port
 CROSS JOIN LATERAL unnest(ARRAY[
   port.name,
   port.sub_name_1,
   port.sub_name_2,
   port.port_of_call
 ]) alias(value)
 WHERE NULLIF(BTRIM(alias.value), '') IS NOT NULL;

CREATE INDEX booking_port_aliases_key_idx ON booking_port_aliases(alias_key);

CREATE TEMP TABLE booking_port_codes (
  code_key TEXT NOT NULL,
  port_id INTEGER NOT NULL
) ON COMMIT DROP;

INSERT INTO booking_port_codes (code_key, port_id)
SELECT DISTINCT UPPER(BTRIM(port.code)), port.id::integer
  FROM public.ports port
 WHERE NULLIF(BTRIM(port.code), '') IS NOT NULL;

CREATE INDEX booking_port_codes_key_idx ON booking_port_codes(code_key);

CREATE TEMP TABLE booking_port_snapshots (
  snapshot_key TEXT PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO booking_port_snapshots (snapshot_key)
SELECT DISTINCT UPPER(BTRIM(snapshot.value))
  FROM (
    SELECT field.value
      FROM public.booking_records record
      CROSS JOIN LATERAL jsonb_each_text(record.payload) field
     WHERE field.key = ANY(ARRAY['placeOfReceipt','portOfLoading','placeOfIssue','pickupPlace','portOfDischarge','placeOfDelivery','dropoffPlace','transitPort'])
    UNION ALL
    SELECT field.value
      FROM public.bill_of_lading_records record
      CROSS JOIN LATERAL jsonb_each_text(record.payload) field
     WHERE field.key = ANY(ARRAY['placeOfReceipt','portOfLoading','portOfDischarge','placeOfDelivery','placeOfIssue'])
    UNION ALL
    SELECT field.value
      FROM public.arrival_notice_records record
      CROSS JOIN LATERAL jsonb_each_text(record.payload) field
     WHERE field.key = ANY(ARRAY['placeOfReceipt','portOfLoading','portOfDischarge','placeOfDelivery','finalDestination'])
    UNION ALL
    SELECT field.value
      FROM public.delivery_order_records record
      CROSS JOIN LATERAL jsonb_each_text(record.payload) field
     WHERE field.key = ANY(ARRAY['placeOfReceipt','portOfLoading','portOfDischarge','placeOfDelivery','finalDestination'])
  ) snapshot
 WHERE NULLIF(BTRIM(snapshot.value), '') IS NOT NULL;

CREATE TEMP TABLE booking_port_resolutions (
  snapshot_key TEXT PRIMARY KEY,
  port_id INTEGER
) ON COMMIT DROP;

WITH candidates AS (
  SELECT snapshot.snapshot_key, alias.port_id
    FROM booking_port_snapshots snapshot
    JOIN booking_port_aliases alias ON alias.alias_key = snapshot.snapshot_key
  UNION
  SELECT snapshot.snapshot_key, code.port_id
    FROM booking_port_snapshots snapshot
   CROSS JOIN LATERAL regexp_matches(
     snapshot.snapshot_key,
     '(?:^|[^A-Z0-9])([A-Z]{2}[A-Z0-9]{3})(?:[^A-Z0-9]|$)',
     'g'
   ) code_match(token)
    JOIN booking_port_codes code ON code.code_key = code_match.token[1]
)
INSERT INTO booking_port_resolutions (snapshot_key, port_id)
SELECT snapshot.snapshot_key,
       CASE WHEN COUNT(DISTINCT candidates.port_id) = 1
            THEN MIN(candidates.port_id)::integer END
  FROM booking_port_snapshots snapshot
  LEFT JOIN candidates ON candidates.snapshot_key = snapshot.snapshot_key
 GROUP BY snapshot.snapshot_key;

CREATE OR REPLACE FUNCTION pg_temp.resolve_booking_port(snapshot TEXT)
RETURNS INTEGER LANGUAGE SQL STABLE AS $resolver$
  SELECT resolution.port_id
    FROM pg_temp.booking_port_resolutions resolution
   WHERE resolution.snapshot_key = UPPER(BTRIM(snapshot))
$resolver$;

-- statement-break
-- Prefer a valid ID captured by the new UI. Legacy rows without an ID fall
-- back to the conservative unique snapshot resolver above; invalid/stale IDs
-- never bypass the ports FK.
CREATE OR REPLACE FUNCTION pg_temp.booking_port_id(
  source JSONB,
  id_key TEXT,
  snapshot_key TEXT
)
RETURNS INTEGER LANGUAGE plpgsql STABLE AS $resolver$
DECLARE
  raw_id TEXT := source ->> id_key;
  explicit_id INTEGER;
BEGIN
  IF raw_id ~ '^[1-9][0-9]*$' AND LENGTH(raw_id) <= 10 THEN
    BEGIN
      SELECT port.id INTO explicit_id
        FROM public.ports port
       WHERE port.id = raw_id::INTEGER;
    EXCEPTION WHEN numeric_value_out_of_range THEN
      explicit_id := NULL;
    END;
    IF explicit_id IS NOT NULL THEN
      RETURN explicit_id;
    END IF;
  END IF;
  RETURN pg_temp.resolve_booking_port(source ->> snapshot_key);
END
$resolver$;

-- statement-break
UPDATE public.booking_records record SET
  presentation_payload = COALESCE((SELECT jsonb_object_agg(entry.key, entry.value) FROM jsonb_each(record.payload) entry WHERE entry.key = ANY(ARRAY['descriptionOfGoods','shippingMark','marks','note','notes','specialRemark','to','contact','pic','commodity','commodityType','commodityName','volume','placeOfReceipt','portOfLoading','placeOfIssue','pickupPlace','portOfDischarge','placeOfDelivery','dropoffPlace','transitPort'])), '{}'::jsonb),
  presentation_schema_version = 1,
  document_number_v2 = NULLIF(BTRIM(payload->>'bookingNumber'), ''),
  document_date = CASE WHEN payload->>'date' ~ '^\d{4}-\d{2}-\d{2}$' THEN (payload->>'date')::date END,
  client_party_id = CASE WHEN payload->>'clientPartyId' ~ '^\d+$' THEN (payload->>'clientPartyId')::integer END,
  vessel_voyage_text = NULLIF(BTRIM(payload->>'vesselVoyage'), ''),
  etd = CASE WHEN payload->>'etd' ~ '^\d{4}-\d{2}-\d{2}$' THEN (payload->>'etd')::date END,
  eta = CASE WHEN payload->>'eta' ~ '^\d{4}-\d{2}-\d{2}$' THEN (payload->>'eta')::date END,
  place_of_receipt_port_id=pg_temp.booking_port_id(payload,'placeOfReceiptPortId','placeOfReceipt'),
  port_of_loading_id=pg_temp.booking_port_id(payload,'portOfLoadingPortId','portOfLoading'),
  place_of_issue_port_id=pg_temp.booking_port_id(payload,'placeOfIssuePortId','placeOfIssue'),
  pickup_port_id=pg_temp.booking_port_id(payload,'pickupPlacePortId','pickupPlace'),
  port_of_discharge_id=pg_temp.booking_port_id(payload,'portOfDischargePortId','portOfDischarge'),
  place_of_delivery_port_id=pg_temp.booking_port_id(payload,'placeOfDeliveryPortId','placeOfDelivery'),
  dropoff_port_id=pg_temp.booking_port_id(payload,'dropoffPlacePortId','dropoffPlace'),
  transit_port_id=pg_temp.booking_port_id(payload,'transitPortId','transitPort'),
  pickup_date = CASE WHEN payload->>'pickupDate' ~ '^\d{4}-\d{2}-\d{2}$' THEN (payload->>'pickupDate')::date END,
  closing_time = CASE WHEN payload->>'closingTime' ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}' THEN LEFT(REPLACE(payload->>'closingTime','T',' '),16)::timestamp END,
  si_cutoff = CASE WHEN payload->>'siCutoff' ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}' THEN LEFT(REPLACE(payload->>'siCutoff','T',' '),16)::timestamp END,
  vgm_cutoff = CASE WHEN payload->>'vgmCutoff' ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}' THEN LEFT(REPLACE(payload->>'vgmCutoff','T',' '),16)::timestamp END,
  commodity_type_id = CASE WHEN payload->>'commodityTypeId' ~ '^\d+$' THEN (payload->>'commodityTypeId')::integer END,
  commodity_id = CASE WHEN payload->>'commodityId' ~ '^\d+$' THEN (payload->>'commodityId')::integer END,
  gross_weight_kg = NULLIF(substring(REPLACE(payload->>'grossWeight', ',', '') FROM '[-+]?[0-9]+(?:\.[0-9]+)?'), '')::numeric,
  gross_weight_raw = NULLIF(BTRIM(payload->>'grossWeight'), ''),
  measurement_cbm = NULLIF(substring(REPLACE(payload->>'measurement', ',', '') FROM '[-+]?[0-9]+(?:\.[0-9]+)?'), '')::numeric,
  measurement_raw = NULLIF(BTRIM(payload->>'measurement'), ''),
  mother_vessel = NULLIF(BTRIM(payload->>'motherVessel'), ''),
  mother_voyage = NULLIF(BTRIM(payload->>'motherVoyage'), ''),
  pic_user_id = CASE WHEN payload->>'picUserId' ~ '^\d+$' THEN (payload->>'picUserId')::integer END;

-- statement-break
INSERT INTO public.booking_cargo_volumes (booking_id, row_order, container_type_code, quantity)
SELECT record.id, ROW_NUMBER() OVER (PARTITION BY record.id ORDER BY volume.key)-1,
       BTRIM(volume.key), (volume.value #>> '{}')::integer
  FROM public.booking_records record
 CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(record.payload->'cargoVolumes')='object' THEN record.payload->'cargoVolumes' ELSE '{}'::jsonb END) volume
 WHERE BTRIM(volume.key) <> '' AND volume.value #>> '{}' ~ '^\d+$' AND (volume.value #>> '{}')::integer > 0
ON CONFLICT (booking_id, container_type_code) DO UPDATE SET quantity=EXCLUDED.quantity, row_order=EXCLUDED.row_order;

-- statement-break
UPDATE public.bill_of_lading_records record SET
  presentation_payload = COALESCE((SELECT jsonb_object_agg(entry.key, entry.value) FROM jsonb_each(record.payload) entry WHERE entry.key = ANY(ARRAY['descriptionOfGoods','shippingMark','notes','consignor','consignedToOrderOf','notifyAddress','notifyPartySameAsConsignee','numberAndKindOfPackages','declarationOfInterest','declaredValue','cargoInsurance','deliveryApplyTo','numberOfOriginals','blFormVariant','placeOfReceipt','portOfLoading','portOfDischarge','placeOfDelivery','placeOfIssue'])), '{}'::jsonb),
  presentation_schema_version=1, document_number_v2=NULLIF(BTRIM(payload->>'fblNumber'),''),
  document_date=CASE WHEN payload->>'dateOfIssue' ~ '^\d{4}-\d{2}-\d{2}$' THEN (payload->>'dateOfIssue')::date END,
  shipper_party_id=CASE WHEN payload->>'shipperPartyId' ~ '^\d+$' THEN (payload->>'shipperPartyId')::integer END,
  consignee_party_id=CASE WHEN payload->>'consigneePartyId' ~ '^\d+$' THEN (payload->>'consigneePartyId')::integer END,
  notify_party_id=CASE WHEN payload->>'notifyPartyId' ~ '^\d+$' THEN (payload->>'notifyPartyId')::integer END,
  place_of_receipt_port_id=pg_temp.booking_port_id(payload,'placeOfReceiptPortId','placeOfReceipt'), port_of_loading_id=pg_temp.booking_port_id(payload,'portOfLoadingPortId','portOfLoading'),
  port_of_discharge_id=pg_temp.booking_port_id(payload,'portOfDischargePortId','portOfDischarge'), place_of_delivery_port_id=pg_temp.booking_port_id(payload,'placeOfDeliveryPortId','placeOfDelivery'), place_of_issue_port_id=pg_temp.booking_port_id(payload,'placeOfIssuePortId','placeOfIssue'),
  ocean_vessel_text=NULLIF(BTRIM(payload->>'oceanVessel'),''), service_mode=NULLIF(BTRIM(payload->>'serviceMode'),''),
  gross_weight_kg=NULLIF(substring(REPLACE(payload->>'grossWeight',',','') FROM '[-+]?[0-9]+(?:\.[0-9]+)?'),'')::numeric, gross_weight_raw=NULLIF(BTRIM(payload->>'grossWeight'),''),
  measurement_cbm=NULLIF(substring(REPLACE(payload->>'measurement',',','') FROM '[-+]?[0-9]+(?:\.[0-9]+)?'),'')::numeric, measurement_raw=NULLIF(BTRIM(payload->>'measurement'),''),
  freight_terms=NULLIF(BTRIM(payload->>'freightTerms'),''), clean_on_board_date=CASE WHEN payload->>'cleanOnBoardDate' ~ '^\d{4}-\d{2}-\d{2}$' THEN (payload->>'cleanOnBoardDate')::date END,
  freight_amount=NULLIF(substring(REPLACE(payload->>'freightAmount',',','') FROM '[-+]?[0-9]+(?:\.[0-9]+)?'),'')::numeric,
  freight_amount_raw=NULLIF(BTRIM(payload->>'freightAmount'),''), freight_payable_at=NULLIF(BTRIM(payload->>'freightPayableAt'),'');

-- statement-break
UPDATE public.arrival_notice_records record SET
  presentation_payload=COALESCE((SELECT jsonb_object_agg(entry.key,entry.value) FROM jsonb_each(record.payload) entry WHERE entry.key=ANY(ARRAY['descriptionOfGoods','marks','note','agent','shipper','consignee','notifyParty','notifyPartySameAsConsignee','customerAttention','commodity','commodityType','commodityName','volume','billOfLadingType','placeOfReceipt','portOfLoading','portOfDischarge','placeOfDelivery','finalDestination'])), '{}'::jsonb),
  presentation_schema_version=1, document_number_v2=NULLIF(BTRIM(payload->>'anNumber'),''), document_date=CASE WHEN payload->>'date' ~ '^\d{4}-\d{2}-\d{2}$' THEN (payload->>'date')::date END,
  agent_party_id=CASE WHEN payload->>'agentPartyId' ~ '^\d+$' THEN (payload->>'agentPartyId')::integer END, shipper_party_id=CASE WHEN payload->>'shipperPartyId' ~ '^\d+$' THEN (payload->>'shipperPartyId')::integer END,
  consignee_party_id=CASE WHEN payload->>'consigneePartyId' ~ '^\d+$' THEN (payload->>'consigneePartyId')::integer END, notify_party_id=CASE WHEN payload->>'notifyPartyId' ~ '^\d+$' THEN (payload->>'notifyPartyId')::integer END,
  master_bill_number_v2=NULLIF(BTRIM(payload->>'mblNumber'),''), house_bill_number_v2=NULLIF(BTRIM(payload->>'hblNumber'),''), shipment_number_v2=NULLIF(BTRIM(payload->>'shipmentNumber'),''), reference_number_v2=NULLIF(BTRIM(payload->>'referenceNumber'),''),
  vessel_voyage_text=NULLIF(BTRIM(payload->>'vesselVoyage'),''), etd=CASE WHEN payload->>'etd' ~ '^\d{4}-\d{2}-\d{2}$' THEN (payload->>'etd')::date END, eta=CASE WHEN payload->>'eta' ~ '^\d{4}-\d{2}-\d{2}$' THEN (payload->>'eta')::date END,
  place_of_receipt_port_id=pg_temp.booking_port_id(payload,'placeOfReceiptPortId','placeOfReceipt'), port_of_loading_id=pg_temp.booking_port_id(payload,'portOfLoadingPortId','portOfLoading'), port_of_discharge_id=pg_temp.booking_port_id(payload,'portOfDischargePortId','portOfDischarge'), place_of_delivery_port_id=pg_temp.booking_port_id(payload,'placeOfDeliveryPortId','placeOfDelivery'), final_destination_port_id=pg_temp.booking_port_id(payload,'finalDestinationPortId','finalDestination'),
  service_mode=NULLIF(BTRIM(payload->>'serviceMode'),''), cfs_terminal=NULLIF(BTRIM(payload->>'cfsTerminal'),''), commodity_type_id=CASE WHEN payload->>'commodityTypeId' ~ '^\d+$' THEN (payload->>'commodityTypeId')::integer END, commodity_id=CASE WHEN payload->>'commodityId' ~ '^\d+$' THEN (payload->>'commodityId')::integer END;

-- statement-break
UPDATE public.delivery_order_records record SET
  presentation_payload=COALESCE((SELECT jsonb_object_agg(entry.key,entry.value) FROM jsonb_each(record.payload) entry WHERE entry.key=ANY(ARRAY['descriptionOfGoods','marks','note','to','deliverTo','notifyParty','customerAttention','volume','cargoRows','placeOfReceipt','portOfLoading','portOfDischarge','placeOfDelivery','finalDestination'])), '{}'::jsonb),
  presentation_schema_version=1, document_number_v2=NULLIF(BTRIM(payload->>'doNumber'),''), document_date=CASE WHEN payload->>'date' ~ '^\d{4}-\d{2}-\d{2}$' THEN (payload->>'date')::date END,
  consignee_party_id=CASE WHEN payload->>'consigneePartyId' ~ '^\d+$' THEN (payload->>'consigneePartyId')::integer END, notify_party_id=CASE WHEN payload->>'notifyPartyId' ~ '^\d+$' THEN (payload->>'notifyPartyId')::integer END,
  master_bill_number_v2=NULLIF(BTRIM(payload->>'mblNumber'),''), house_bill_number_v2=NULLIF(BTRIM(payload->>'hblNumber'),''), shipment_number_v2=NULLIF(BTRIM(payload->>'shipmentNumber'),''), vessel_voyage_text=NULLIF(BTRIM(payload->>'vesselVoyage'),''),
  place_of_receipt_port_id=pg_temp.booking_port_id(payload,'placeOfReceiptPortId','placeOfReceipt'), port_of_loading_id=pg_temp.booking_port_id(payload,'portOfLoadingPortId','portOfLoading'), port_of_discharge_id=pg_temp.booking_port_id(payload,'portOfDischargePortId','portOfDischarge'), place_of_delivery_port_id=pg_temp.booking_port_id(payload,'placeOfDeliveryPortId','placeOfDelivery'), final_destination_port_id=pg_temp.booking_port_id(payload,'finalDestinationPortId','finalDestination'),
  etd=CASE WHEN payload->>'etd' ~ '^\d{4}-\d{2}-\d{2}$' THEN (payload->>'etd')::date END, eta=CASE WHEN payload->>'eta' ~ '^\d{4}-\d{2}-\d{2}$' THEN (payload->>'eta')::date END, service_mode=NULLIF(BTRIM(payload->>'serviceMode'),''), cfs_terminal=NULLIF(BTRIM(payload->>'cfsTerminal'),'');

-- Container backfill is repeated per owner so document snapshots remain independent.
-- statement-break
INSERT INTO public.bill_of_lading_containers (document_id,row_order,container_type_code,container_no,seal_no,gross_weight_kg,gross_weight_raw,measurement_cbm,measurement_raw,tare_kg,tare_raw,package_type_id,package_type_snapshot,number_of_packages,number_of_packages_raw,method,presentation_payload)
SELECT record.id, item.ordinality-1, NULLIF(BTRIM(item.row->>'type'),''),NULLIF(BTRIM(item.row->>'containerNo'),''),NULLIF(BTRIM(item.row->>'sealNo'),''),NULLIF(substring(REPLACE(item.row->>'grossWeight',',','') FROM '[-+]?[0-9]+(?:\.[0-9]+)?'),'')::numeric,NULLIF(BTRIM(item.row->>'grossWeight'),''),NULLIF(substring(REPLACE(item.row->>'measurement',',','') FROM '[-+]?[0-9]+(?:\.[0-9]+)?'),'')::numeric,NULLIF(BTRIM(item.row->>'measurement'),''),NULLIF(substring(REPLACE(item.row->>'tare',',','') FROM '[-+]?[0-9]+(?:\.[0-9]+)?'),'')::numeric,NULLIF(BTRIM(item.row->>'tare'),''),COALESCE(CASE WHEN item.row->>'packageTypeId' ~ '^\d+$' THEN (item.row->>'packageTypeId')::integer END,(SELECT MIN(type.id)::integer FROM public.commodity_types type JOIN public.service_types service ON service.id=type.service_type_id AND UPPER(BTRIM(service.name))='FREIGHT FORWARDING' WHERE LOWER(REGEXP_REPLACE(BTRIM(type.name),'\s+',' ','g'))=LOWER(REGEXP_REPLACE(BTRIM(item.row->>'packageType'),'\s+',' ','g')) HAVING COUNT(*)=1)),NULLIF(BTRIM(item.row->>'packageType'),''),CASE WHEN item.row->>'noOfPkgs' ~ '^\d+$' THEN (item.row->>'noOfPkgs')::integer END,NULLIF(BTRIM(item.row->>'noOfPkgs'),''),NULLIF(BTRIM(item.row->>'method'),''),CASE WHEN NULLIF(BTRIM(item.row->>'note'),'') IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('note',BTRIM(item.row->>'note')) END
FROM public.bill_of_lading_records record CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(record.payload->'containers')='array' THEN record.payload->'containers' ELSE '[]'::jsonb END) WITH ORDINALITY item(row,ordinality)
WHERE EXISTS (SELECT 1 FROM jsonb_each_text(item.row) field WHERE BTRIM(field.value)<>'') ON CONFLICT(document_id,row_order) DO NOTHING;

-- statement-break
DO $migration$
DECLARE owner RECORD;
BEGIN
  FOR owner IN SELECT * FROM (VALUES
    ('arrival_notice_containers','arrival_notice_records'),
    ('delivery_order_containers','delivery_order_records')
  ) AS owners(target_table, source_table)
  LOOP
    EXECUTE format($sql$
      INSERT INTO public.%I (document_id,row_order,container_type_code,container_no,seal_no,gross_weight_kg,gross_weight_raw,measurement_cbm,measurement_raw,tare_kg,tare_raw,package_type_id,package_type_snapshot,number_of_packages,number_of_packages_raw,method,presentation_payload)
      SELECT record.id, item.ordinality-1, NULLIF(BTRIM(item.row->>'type'),''),NULLIF(BTRIM(item.row->>'containerNo'),''),NULLIF(BTRIM(item.row->>'sealNo'),''),NULLIF(substring(REPLACE(item.row->>'grossWeight',',','') FROM '[-+]?[0-9]+(?:\.[0-9]+)?'),'')::numeric,NULLIF(BTRIM(item.row->>'grossWeight'),''),NULLIF(substring(REPLACE(item.row->>'measurement',',','') FROM '[-+]?[0-9]+(?:\.[0-9]+)?'),'')::numeric,NULLIF(BTRIM(item.row->>'measurement'),''),NULLIF(substring(REPLACE(item.row->>'tare',',','') FROM '[-+]?[0-9]+(?:\.[0-9]+)?'),'')::numeric,NULLIF(BTRIM(item.row->>'tare'),''),COALESCE(CASE WHEN item.row->>'packageTypeId' ~ '^\d+$' THEN (item.row->>'packageTypeId')::integer END,(SELECT MIN(type.id)::integer FROM public.commodity_types type JOIN public.service_types service ON service.id=type.service_type_id AND UPPER(BTRIM(service.name))='FREIGHT FORWARDING' WHERE LOWER(REGEXP_REPLACE(BTRIM(type.name),'\s+',' ','g'))=LOWER(REGEXP_REPLACE(BTRIM(item.row->>'packageType'),'\s+',' ','g')) HAVING COUNT(*)=1)),NULLIF(BTRIM(item.row->>'packageType'),''),CASE WHEN item.row->>'noOfPkgs' ~ '^\d+$' THEN (item.row->>'noOfPkgs')::integer END,NULLIF(BTRIM(item.row->>'noOfPkgs'),''),NULLIF(BTRIM(item.row->>'method'),''),CASE WHEN NULLIF(BTRIM(item.row->>'note'),'') IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('note',BTRIM(item.row->>'note')) END
        FROM public.%I record CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(record.payload->'containers')='array' THEN record.payload->'containers' ELSE '[]'::jsonb END) WITH ORDINALITY item(row,ordinality)
       WHERE EXISTS (SELECT 1 FROM jsonb_each_text(item.row) field WHERE BTRIM(field.value)<>'')
      ON CONFLICT(document_id,row_order) DO NOTHING
    $sql$, owner.target_table, owner.source_table);
  END LOOP;
END $migration$;
