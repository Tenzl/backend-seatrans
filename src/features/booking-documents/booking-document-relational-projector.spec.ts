import { BookingDocumentType } from './enums/booking-document-type.enum';
import {
  nonBlankCargoVolumes,
  nonBlankContainers,
  parseReportNumber,
  projectRelationalFields,
} from './booking-document-relational-projector';

describe('booking document relational projection', () => {
  it('preserves raw numeric input and extracts a report number', () => {
    expect(parseReportNumber("24,000 KGS/20'")).toEqual({
      numeric: '24000',
      raw: "24,000 KGS/20'",
    });
  });

  it('separates presentation data from report fields', () => {
    expect(
      projectRelationalFields(BookingDocumentType.BOOKING_CONFIRMATION, {
        bookingNumber: 'BK-1',
        clientPartyId: 3,
        portOfLoading: 'QUY NHON (VNUIH)',
        portOfLoadingPortId: 42,
        portOfDischargePortId: 'invalid',
        descriptionOfGoods: 'STONE',
        grossWeight: '24,000',
      }),
    ).toMatchObject({
      documentNumberV2: 'BK-1',
      clientPartyId: 3,
      portOfLoadingId: 42,
      portOfDischargeId: null,
      grossWeightKg: '24000',
      presentationPayload: {
        descriptionOfGoods: 'STONE',
        portOfLoading: 'QUY NHON (VNUIH)',
      },
    });
  });

  it('projects every Booking route identity without replacing snapshots', () => {
    expect(
      projectRelationalFields(BookingDocumentType.BOOKING_CONFIRMATION, {
        placeOfReceiptPortId: 1,
        portOfLoadingPortId: 2,
        placeOfIssuePortId: 3,
        pickupPlacePortId: 4,
        portOfDischargePortId: 5,
        placeOfDeliveryPortId: 6,
        dropoffPlacePortId: 7,
        transitPortId: 8,
      }),
    ).toMatchObject({
      placeOfReceiptPortId: 1,
      portOfLoadingId: 2,
      placeOfIssuePortId: 3,
      pickupPortId: 4,
      portOfDischargeId: 5,
      placeOfDeliveryPortId: 6,
      dropoffPortId: 7,
      transitPortId: 8,
    });
  });

  it('dual-writes all Booking operational fields', () => {
    expect(
      projectRelationalFields(BookingDocumentType.BOOKING_CONFIRMATION, {
        pickupDate: '2026-08-22',
        closingTime: '2026-08-21 17:00',
        siCutoff: '2026-08-21 15:00',
        vgmCutoff: '2026-08-21 16:00',
        motherVessel: 'MOTHER VESSEL',
        motherVoyage: 'MV001',
      }),
    ).toMatchObject({
      pickupDate: '2026-08-22',
      closingTime: '2026-08-21 17:00',
      siCutoff: '2026-08-21 15:00',
      vgmCutoff: '2026-08-21 16:00',
      motherVessel: 'MOTHER VESSEL',
      motherVoyage: 'MV001',
    });
  });

  it('dual-writes Bill freight fields and preserves raw freight text', () => {
    expect(
      projectRelationalFields(BookingDocumentType.BILL_OF_LADING, {
        freightTerms: 'PREPAID',
        cleanOnBoardDate: '2026-08-22',
        freightAmount: 'USD 1,250.50',
        freightPayableAt: 'QUY NHON',
      }),
    ).toMatchObject({
      freightTerms: 'PREPAID',
      cleanOnBoardDate: '2026-08-22',
      freightAmount: '1250.50',
      freightAmountRaw: 'USD 1,250.50',
      freightPayableAt: 'QUY NHON',
    });
  });

  it('dual-writes Arrival Notice and Delivery Order report fields', () => {
    const shared = {
      mblNumber: 'MBL-1',
      hblNumber: 'HBL-1',
      shipmentNumber: 'S-1',
      etd: '2026-08-21',
      eta: '2026-08-24',
      cfsTerminal: 'CFS A',
    };
    expect(
      projectRelationalFields(BookingDocumentType.ARRIVAL_NOTICE, {
        ...shared,
        referenceNumber: 'REF-1',
        commodityTypeId: 177,
        commodityId: 9,
      }),
    ).toMatchObject({
      masterBillNumberV2: 'MBL-1',
      houseBillNumberV2: 'HBL-1',
      shipmentNumberV2: 'S-1',
      referenceNumberV2: 'REF-1',
      etd: '2026-08-21',
      eta: '2026-08-24',
      cfsTerminal: 'CFS A',
      commodityTypeId: 177,
      commodityId: 9,
    });
    expect(
      projectRelationalFields(BookingDocumentType.DELIVERY_ORDER, shared),
    ).toMatchObject({
      masterBillNumberV2: 'MBL-1',
      houseBillNumberV2: 'HBL-1',
      shipmentNumberV2: 'S-1',
      etd: '2026-08-21',
      eta: '2026-08-24',
      cfsTerminal: 'CFS A',
    });
  });

  it('never creates blank repeated rows', () => {
    expect(
      nonBlankCargoVolumes({ cargoVolumes: { "20'DC": 2, "40'HC": 0 } }),
    ).toHaveLength(1);
    expect(
      nonBlankContainers({ containers: [{}, { type: '' }, { type: "20'DC" }] }),
    ).toEqual([{ type: "20'DC" }]);
  });
});
