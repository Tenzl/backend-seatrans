import {
  missingRequiredDocumentFields,
  REQUIRED_CONTAINER_FIELDS,
} from './booking-document-requirements';
import { BookingDocumentType } from './enums/booking-document-type.enum';

const completeContainer = {
  type: "20'DC",
  containerNo: 'CONT-1',
  sealNo: 'SEAL-1',
  grossWeight: '24,000',
  measurement: '28.5',
  noOfPkgs: '10',
  packageType: 'PKGS',
};

describe('booking document required fields', () => {
  it('requires the operational Booking fields and a positive cargo volume', () => {
    const payload = {
      bookingNumber: 'BK-1',
      date: '2026-08-21',
      to: 'Customer',
      vesselVoyage: 'VESSEL / V1',
      etd: '2026-08-22',
      eta: '2026-08-25',
      portOfLoading: 'QUY NHON PORT, VN (VNUIH)',
      portOfDischarge: 'TOKYO, JP (JPTYO)',
      commodityType: 'PKGS',
      commodityName: 'STONE',
      grossWeight: '24,000 KGS',
      measurement: '28.5 CBM',
      pic: 'Operator',
      cargoVolumes: { "20'DC": 1 },
    };

    expect(
      missingRequiredDocumentFields(
        BookingDocumentType.BOOKING_CONFIRMATION,
        payload,
      ),
    ).toEqual([]);
    expect(
      missingRequiredDocumentFields(BookingDocumentType.BOOKING_CONFIRMATION, {
        ...payload,
        eta: '',
        cargoVolumes: {},
      }),
    ).toEqual(expect.arrayContaining(['eta', 'cargoVolumes']));
  });

  it('keeps a document processing until every meaningful container is complete', () => {
    const payload = {
      fblNumber: 'BL-1',
      consignor: 'Shipper',
      consignedToOrderOf: 'Consignee',
      oceanVessel: 'VESSEL / V1',
      portOfLoading: 'VNUIH',
      portOfDischarge: 'JPTYO',
      serviceMode: 'FCL/FCL - CY/CY',
      shippingMark: 'N/M',
      descriptionOfGoods: 'STONE',
      placeOfIssue: 'QUY NHON',
      dateOfIssue: '2026-08-21',
      numberOfOriginals: 'THREE/3',
      containers: [completeContainer],
    };

    expect(
      missingRequiredDocumentFields(
        BookingDocumentType.BILL_OF_LADING,
        payload,
      ),
    ).toEqual([]);
    const missing = missingRequiredDocumentFields(
      BookingDocumentType.BILL_OF_LADING,
      {
        ...payload,
        containers: [{ ...completeContainer, sealNo: '', measurement: '0' }],
      },
    );
    expect(missing).toEqual(
      expect.arrayContaining([
        'containers[0].sealNo',
        'containers[0].measurement',
      ]),
    );
    expect(REQUIRED_CONTAINER_FIELDS).not.toContain('note');
  });
});
