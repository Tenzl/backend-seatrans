import { BadRequestException } from '@nestjs/common';
import { BookingDocumentsV2Service } from './booking-documents-v2.service';
import { BookingDocumentType } from './enums/booking-document-type.enum';

describe('BookingDocumentsV2Service', () => {
  const legacy = {
    createRecord: jest.fn(),
    updateRecord: jest.fn(),
    getRecord: jest.fn(),
    listRecords: jest.fn(),
  };
  const dataSource = { query: jest.fn() };
  const service = new BookingDocumentsV2Service(
    legacy as never,
    dataSource as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('rejects operational identifiers hidden inside presentation', async () => {
    await expect(
      service.create(
        BookingDocumentType.BOOKING_CONFIRMATION,
        {
          document: { bookingNumber: 'BK-1' },
          presentation: { clientPartyId: 9 },
        },
        1,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(legacy.createRecord).not.toHaveBeenCalled();
  });

  it('removes zero and blank cargo-volume rows from the v2 wire', async () => {
    legacy.createRecord.mockResolvedValue({
      id: 1,
      documentType: 'booking',
      payload: {
        bookingNumber: 'BK-1',
        descriptionOfGoods: 'STONE',
        cargoVolumes: { "20'DC": 2 },
      },
    });
    const result = await service.create(
      BookingDocumentType.BOOKING_CONFIRMATION,
      {
        document: { bookingNumber: 'BK-1' },
        presentation: { descriptionOfGoods: 'STONE' },
        cargoVolumes: [
          { containerTypeCode: "20'DC", quantity: 2 },
          { containerTypeCode: "40'HC", quantity: 0 },
          { containerTypeCode: '', quantity: 1 },
        ],
      },
      1,
    );
    expect(legacy.createRecord).toHaveBeenCalledWith(
      BookingDocumentType.BOOKING_CONFIRMATION,
      expect.objectContaining({ cargoVolumes: { "20'DC": 2 } }),
      1,
    );
    expect(result.cargoVolumes).toEqual([
      { containerTypeCode: "20'DC", quantity: 2, rowOrder: 0 },
    ]);
  });

  it('rejects malformed repeated-row envelopes before legacy validation', async () => {
    await expect(
      service.create(
        BookingDocumentType.BOOKING_CONFIRMATION,
        {
          document: { bookingNumber: 'BK-1' },
          cargoVolumes: { "20'DC": 1 },
        },
        1,
      ),
    ).rejects.toThrow('cargoVolumes must be an array');
    expect(legacy.createRecord).not.toHaveBeenCalled();
  });

  it('rejects invalid report filters without querying PostgreSQL', async () => {
    await expect(service.report({ clientPartyId: '1 OR 1=1' })).rejects.toThrow(
      'clientPartyId must be a positive integer',
    );
    await expect(service.report({ dateFrom: '2026-02-31' })).rejects.toThrow(
      'dateFrom is not a valid date',
    );
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('queries the one-row-per-booking view with shared report filters', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ booking_id: 1, booking_number: 'BK-1' }])
      .mockResolvedValueOnce([{ total_bookings: 1, planned_containers: 2 }]);

    const result = await service.report({
      flow: 'export',
      clientPartyId: '7',
      page: '0',
      size: '20',
    });

    expect(dataSource.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM booking_reporting_v1'),
      ['EXPORT', 7, 20, 0],
    );
    expect(dataSource.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM booking_reporting_v1'),
      ['EXPORT', 7],
    );
    expect(result).toMatchObject({
      totalElements: 1,
      totalPages: 1,
      content: [{ booking_id: 1 }],
    });
  });
});
