-- Seed one complete EXPORT workflow and one complete IMPORT workflow
-- for transport-document UI testing:
--   EXPORT: Booking Confirmation → BL (no AN)
--   IMPORT: Booking Confirmation → AN → DO
--
-- Idempotent: skips when SAMPLE-EXP-BK / SAMPLE-IMP-BK already exist
-- (active rows, deleted_at IS NULL).
--
-- Prefer the runner:
--   node scripts/seed-import-export-booking-workflows.mjs --apply --target-db=<db>
--
-- Or apply via psql after setting :created_by_user_id (defaults to smallest users.id).

BEGIN;

DO $$
DECLARE
  actor_id INTEGER;
  export_booking_id BIGINT;
  import_booking_id BIGINT;
BEGIN
  SELECT id INTO actor_id FROM users ORDER BY id ASC LIMIT 1;
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'No users row available for created_by_user_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM booking_document_records
    WHERE reference_number = 'SAMPLE-EXP-BK' AND deleted_at IS NULL
  ) THEN
    RAISE NOTICE 'SAMPLE-EXP-BK already present — skipping EXPORT seed';
  ELSE
    INSERT INTO booking_document_records (
      document_type, booking_flow, booking_id, reference_number, payload,
      status, created_by_user_id, updated_by_user_id, created_at, updated_at
    ) VALUES (
      'booking', 'EXPORT', NULL, 'SAMPLE-EXP-BK',
      jsonb_build_object(
        'date', '04/08/2026',
        'bookingNumber', 'SAMPLE-EXP-BK',
        'to', E'SEKIGAHARA STONE CO., LTD.\n2682 SEKIGAHARA, FUWA-GUN, GIFU-KEN, 503-1595 JAPAN',
        'vesselVoyage', 'SITC MINHE / 2615N',
        'etd', '14/06/2026',
        'eta', '22/06/2026',
        'placeOfReceipt', 'QUI NHON, VN (VNUIH)',
        'portOfLoading', 'DA NANG, VN (VNDAD)',
        'pickupDate', '12/06/2026',
        'pickupPlace', 'QUI NHON ICD',
        'portOfDischarge', 'HAKATA, FUKUOKA, JP (JPHKT)',
        'placeOfDelivery', 'HAKATA, FUKUOKA, JP (JPHKT)',
        'dropoffPlace', 'HAKATA CFS',
        'closingTime', '13/06/2026 17:00',
        'siCutoff', '13/06/2026 12:00',
        'vgmCutoff', '13/06/2026 15:00',
        'contact', 'ops-export@seatrans.com / +84 236 3655 888',
        'commodity', 'GRANITE STONES, BASALT STONES',
        'volume', '1x20''DC',
        'grossWeight', '20,700 KGS',
        'measurement', '7.26 CBM',
        'transitPort', 'SINGAPORE',
        'specialRemark', 'SAMPLE EXPORT workflow for UI testing — FCL CY/CY',
        'motherVessel', 'SITC MINHE',
        'motherVoyage', '2615N',
        'pic', 'Seatrans Export Desk'
      ),
      'COMPLETED', actor_id, actor_id, NOW(), NOW()
    )
    RETURNING id INTO export_booking_id;

    INSERT INTO booking_document_records (
      document_type, booking_flow, booking_id, reference_number, payload,
      status, created_by_user_id, updated_by_user_id, created_at, updated_at
    ) VALUES (
      'bl', NULL, export_booking_id, 'SAMPLE-EXP-BL',
      jsonb_build_object(
        'fblNumber', 'STVN-260607',
        'consignor', E'AN THINH STONE CO., LTD\n92 HAI BA TRUNG STREET, QUY NHON WARD, GIA LAI PROVINCE, VIETNAM\nTEL: +84-256-3 701 745',
        'consignedToOrderOf', E'SEKIGAHARA STONE CO., LTD.\n2682 SEKIGAHARA, FUWA-GUN, GIFU-KEN, 503-1595 JAPAN',
        'notifyAddress', E'SEKIGAHARA STONE CO., LTD.\n2682 SEKIGAHARA, FUWA-GUN, GIFU-KEN, 503-1595 JAPAN',
        'placeOfReceipt', 'QUI NHON, VN (VNUIH)',
        'oceanVessel', 'SITC MINHE',
        'voyageNumber', '2615N',
        'portOfLoading', 'DA NANG, VN (VNDAD)',
        'portOfDischarge', 'HAKATA, FUKUOKA, JP (JPHKT)',
        'placeOfDelivery', 'HAKATA, FUKUOKA, JP (JPHKT)',
        'marksAndNumbers', E'FCL/FCL - CY/CY\nSITU2631620 / SITR892044 / 20''DC\nN/M',
        'numberAndKindOfPackages', '20 PALLET(S)',
        'descriptionOfGoods', E'AT SHIPPER''S LOAD, COUNT, STOW & SEAL\nSAID TO CONTAIN: ONE CONTAINER(S) ONLY\n1x20''DC\nGRANITE STONES, BASALT STONES\nHS CODE: 68010000',
        'grossWeight', '20,700 KGS',
        'measurement', '7.26 CBM',
        'freightTerms', 'FREIGHT COLLECT',
        'cleanOnBoard', 'CLEAN ON BOARD Jun 14, 2026',
        'declarationOfInterest', '',
        'declaredValue', '',
        'freightAmount', 'AS ARRANGED',
        'freightPayableAt', 'HAKATA, FUKUOKA, JP (JPHKT)',
        'placeOfIssue', 'DA NANG, VN (VNDAD)',
        'dateOfIssue', 'Jun 14, 2026',
        'numberOfOriginals', 'THREE/3',
        'cargoInsurance', 'not_covered',
        'deliveryApplyTo', E'APEX INTERNATIONAL INC.\n7F, TOYOKUNI BLDG, 2-4-6, SHIBA-DAIMON, MINATO-KU, TOKYO 105-0012 JAPAN',
        'blFormVariant', 'surrendered'
      ),
      'COMPLETED', actor_id, actor_id, NOW(), NOW()
    );

    RAISE NOTICE 'Seeded EXPORT workflow booking_id=%', export_booking_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM booking_document_records
    WHERE reference_number = 'SAMPLE-IMP-BK' AND deleted_at IS NULL
  ) THEN
    RAISE NOTICE 'SAMPLE-IMP-BK already present — skipping IMPORT seed';
  ELSE
    INSERT INTO booking_document_records (
      document_type, booking_flow, booking_id, reference_number, payload,
      status, created_by_user_id, updated_by_user_id, created_at, updated_at
    ) VALUES (
      'booking', 'IMPORT', NULL, 'SAMPLE-IMP-BK',
      jsonb_build_object(
        'date', '04/08/2026',
        'bookingNumber', 'SAMPLE-IMP-BK',
        'to', E'VIETNAM STEEL TRADING JSC\n12 NGUYEN VAN LINH, HAI CHAU, DA NANG, VIETNAM',
        'vesselVoyage', 'OOCL TOKYO / 042E',
        'etd', '28/07/2026',
        'eta', '05/08/2026',
        'placeOfReceipt', 'BUSAN, KR (KRPUS)',
        'portOfLoading', 'BUSAN, KR (KRPUS)',
        'pickupDate', '26/07/2026',
        'pickupPlace', 'BUSAN NEW PORT',
        'portOfDischarge', 'DA NANG, VN (VNDAD)',
        'placeOfDelivery', 'DA NANG, VN (VNDAD)',
        'dropoffPlace', 'TIEN SA TERMINAL',
        'closingTime', '27/07/2026 16:00',
        'siCutoff', '27/07/2026 10:00',
        'vgmCutoff', '27/07/2026 14:00',
        'contact', 'ops-import@seatrans.com / +84 236 3655 889',
        'commodity', 'COLD ROLLED STEEL COILS',
        'volume', '2x40''HC',
        'grossWeight', '52,400 KGS',
        'measurement', '110.00 CBM',
        'transitPort', '',
        'specialRemark', 'SAMPLE IMPORT workflow for UI testing — D/O after AN',
        'motherVessel', 'OOCL TOKYO',
        'motherVoyage', '042E',
        'pic', 'Seatrans Import Desk'
      ),
      'COMPLETED', actor_id, actor_id, NOW(), NOW()
    )
    RETURNING id INTO import_booking_id;

    INSERT INTO booking_document_records (
      document_type, booking_flow, booking_id, reference_number, payload,
      status, created_by_user_id, updated_by_user_id, created_at, updated_at
    ) VALUES (
      'an', NULL, import_booking_id, 'SAMPLE-IMP-AN',
      jsonb_build_object(
        'agent', 'SEATRANS DA NANG',
        'date', '04/08/2026',
        'anNumber', 'SAMPLE-IMP-AN',
        'shipper', E'KOREA STEEL EXPORT CO., LTD\n101 CENTUM JUNGANG-RO, HAEUNDAE-GU, BUSAN, KOREA',
        'consignee', E'VIETNAM STEEL TRADING JSC\n12 NGUYEN VAN LINH, HAI CHAU, DA NANG, VIETNAM',
        'notifyParty', E'VIETNAM STEEL TRADING JSC\n12 NGUYEN VAN LINH, HAI CHAU, DA NANG, VIETNAM',
        'mblNumber', 'OOCL-MBL-IMP-001',
        'hblNumber', 'STVN-IMP-260804',
        'vesselVoyage', 'OOCL TOKYO / 042E',
        'etdEta', '28/07/2026 / 05/08/2026',
        'cfsTerminal', 'TIEN SA TERMINAL',
        'shipmentNumber', 'SAMPLE-IMP-BK',
        'referenceNumber', 'SAMPLE-IMP-BK',
        'billOfLadingType', 'Original',
        'placeOfReceipt', 'BUSAN, KR (KRPUS)',
        'portOfLoading', 'BUSAN, KR (KRPUS)',
        'portOfDischarge', 'DA NANG, VN (VNDAD)',
        'placeOfDelivery', 'DA NANG, VN (VNDAD)',
        'finalDestination', 'DA NANG, VN (VNDAD)',
        'serviceMode', 'FCL/FCL - CY/CY',
        'note', 'SAMPLE IMPORT Arrival Notice',
        'marks', E'FCL/FCL - CY/CY\nOOCU8899001 / KRSEAL001\nOOCU8899002 / KRSEAL002\nN/M',
        'volume', '2x40''HC',
        'customerAttention', 'DO will be issued after freight settlement. Please prepare import customs docs.',
        'cargoRows', jsonb_build_array(
          jsonb_build_object(
            'containerSealNumber', 'OOCU8899001 / KRSEAL001',
            'quantity', '1x40''HC',
            'descriptionOfGoods', 'COLD ROLLED STEEL COILS — LOT A',
            'grossWeight', '26,200 KGS',
            'measurement', '55.00 CBM'
          ),
          jsonb_build_object(
            'containerSealNumber', 'OOCU8899002 / KRSEAL002',
            'quantity', '1x40''HC',
            'descriptionOfGoods', 'COLD ROLLED STEEL COILS — LOT B',
            'grossWeight', '26,200 KGS',
            'measurement', '55.00 CBM'
          )
        )
      ),
      'COMPLETED', actor_id, actor_id, NOW(), NOW()
    );

    INSERT INTO booking_document_records (
      document_type, booking_flow, booking_id, reference_number, payload,
      status, created_by_user_id, updated_by_user_id, created_at, updated_at
    ) VALUES (
      'do', NULL, import_booking_id, 'SAMPLE-IMP-DO',
      jsonb_build_object(
        'doNumber', 'SAMPLE-IMP-DO',
        'date', '04/08/2026',
        'to', 'TIEN SA TERMINAL / CFS',
        'deliverTo', E'VIETNAM STEEL TRADING JSC\n12 NGUYEN VAN LINH, HAI CHAU, DA NANG, VIETNAM',
        'notifyParty', E'VIETNAM STEEL TRADING JSC\n12 NGUYEN VAN LINH, HAI CHAU, DA NANG, VIETNAM',
        'mblNumber', 'OOCL-MBL-IMP-001',
        'hblNumber', 'STVN-IMP-260804',
        'etd', '28/07/2026',
        'eta', '05/08/2026',
        'shipmentNumber', 'SAMPLE-IMP-BK',
        'vesselVoyage', 'OOCL TOKYO / 042E',
        'placeOfReceipt', 'BUSAN, KR (KRPUS)',
        'portOfLoading', 'BUSAN, KR (KRPUS)',
        'portOfDischarge', 'DA NANG, VN (VNDAD)',
        'placeOfDelivery', 'DA NANG, VN (VNDAD)',
        'finalDestination', 'DA NANG, VN (VNDAD)',
        'serviceMode', 'FCL/FCL - CY/CY',
        'cfsTerminal', 'TIEN SA TERMINAL',
        'note', 'SAMPLE IMPORT Delivery Order — release against D/O',
        'marks', E'FCL/FCL - CY/CY\nOOCU8899001 / KRSEAL001\nOOCU8899002 / KRSEAL002\nN/M',
        'volume', '2x40''HC',
        'customerAttention', 'Present this D/O with ID at terminal gate.',
        'cargoRows', jsonb_build_array(
          jsonb_build_object(
            'containerSealNumber', 'OOCU8899001 / KRSEAL001',
            'quantity', '1x40''HC',
            'descriptionOfGoods', 'COLD ROLLED STEEL COILS — LOT A',
            'grossWeight', '26,200 KGS',
            'measurement', '55.00 CBM'
          ),
          jsonb_build_object(
            'containerSealNumber', 'OOCU8899002 / KRSEAL002',
            'quantity', '1x40''HC',
            'descriptionOfGoods', 'COLD ROLLED STEEL COILS — LOT B',
            'grossWeight', '26,200 KGS',
            'measurement', '55.00 CBM'
          )
        )
      ),
      'COMPLETED', actor_id, actor_id, NOW(), NOW()
    );

    RAISE NOTICE 'Seeded IMPORT workflow booking_id=%', import_booking_id;
  END IF;
END $$;

COMMIT;
