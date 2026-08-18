import { BookingDocumentRecordService } from './booking-document-record.service';
import { BookingDocumentType } from './enums/booking-document-type.enum';
import { BookingFlow } from './enums/booking-flow.enum';

describe('Booking document copy and duplicate-number queries', () => {
  it('returns a detached booking payload as a new-booking copy source', async () => {
    const payload = { bookingNumber: 'BK-1', vesselVoyage: 'VESSEL / 001' };
    const bookingRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 4,
        bookingFlow: BookingFlow.IMPORT,
        payload,
      }),
    };
    const service = new BookingDocumentRecordService(
      bookingRepository as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const source = await service.getBookingCopySource(4);

    expect(source).toEqual({
      sourceBookingId: 4,
      bookingFlow: BookingFlow.IMPORT,
      payload,
    });
    expect(source.payload).not.toBe(payload);
  });

  it('checks active BL numbers case-insensitively and excludes the edited row', async () => {
    const builder = {
      leftJoinAndSelect: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      take: jest.fn(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 8,
          bookingId: 21,
          booking: { bookingNumber: 'BK-2026-001' },
          payload: { fblNumber: 'HBL-001' },
          fblNumber: 'HBL-001',
          createdAt: new Date('2026-08-17T01:00:00.000Z'),
          deletedAt: null,
        },
      ]),
    };
    for (const method of [
      builder.leftJoinAndSelect,
      builder.where,
      builder.andWhere,
      builder.orderBy,
      builder.addOrderBy,
      builder.take,
    ]) {
      method.mockReturnValue(builder);
    }
    const billOfLadingRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
    };
    const service = new BookingDocumentRecordService(
      {} as never,
      {} as never,
      {} as never,
      billOfLadingRepository as never,
    );

    const matches = await service.findBillOfLadingNumberDuplicates(
      ' hbl-001 ',
      5,
    );

    expect(builder.where).toHaveBeenCalledWith(
      'LOWER(BTRIM(bl.fbl_number)) = LOWER(BTRIM(:number))',
      { number: 'hbl-001' },
    );
    expect(builder.leftJoinAndSelect).toHaveBeenCalledWith(
      'bl.booking',
      'booking',
    );
    expect(builder.andWhere).toHaveBeenCalledWith('bl.id <> :excludeId', {
      excludeId: 5,
    });
    expect(builder.andWhere).toHaveBeenCalledWith('bl.deleted_at IS NULL');
    expect(builder.orderBy).toHaveBeenCalledWith('bl.createdAt', 'DESC');
    expect(builder.addOrderBy).toHaveBeenCalledWith('bl.id', 'DESC');
    expect(matches).toEqual([
      {
        id: 8,
        documentType: BookingDocumentType.BILL_OF_LADING,
        bookingId: 21,
        bookingNumber: 'BK-2026-001',
        number: 'HBL-001',
        createdAt: '2026-08-17T01:00:00.000Z',
      },
    ]);
  });

  it('checks primary numbers across every form using entity createdAt order fields', async () => {
    const makeBuilder = (record: Record<string, unknown>) => {
      const builder = {
        leftJoinAndSelect: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        orderBy: jest.fn(),
        addOrderBy: jest.fn(),
        take: jest.fn(),
        getMany: jest.fn().mockResolvedValue([record]),
      };
      for (const method of [
        builder.leftJoinAndSelect,
        builder.where,
        builder.andWhere,
        builder.orderBy,
        builder.addOrderBy,
        builder.take,
      ]) {
        method.mockReturnValue(builder);
      }
      return builder;
    };
    const createdAt = new Date('2026-08-18T01:00:00.000Z');
    const bookingBuilder = makeBuilder({
      id: 10,
      payload: { bookingNumber: 'SAME-001' },
      createdAt,
      deletedAt: null,
    });
    const anBuilder = makeBuilder({
      id: 11,
      bookingId: 20,
      booking: { bookingNumber: 'BK-AN' },
      payload: { anNumber: 'SAME-001' },
      createdAt,
      deletedAt: null,
    });
    const doBuilder = makeBuilder({
      id: 12,
      bookingId: 21,
      booking: { bookingNumber: 'BK-DO' },
      payload: { doNumber: 'SAME-001' },
      createdAt,
      deletedAt: null,
    });
    const blBuilder = makeBuilder({
      id: 13,
      bookingId: 22,
      booking: { bookingNumber: 'BK-BL' },
      payload: { fblNumber: 'SAME-001' },
      createdAt,
      deletedAt: null,
    });
    const service = new BookingDocumentRecordService(
      {
        createQueryBuilder: jest.fn().mockReturnValue(bookingBuilder),
      } as never,
      { createQueryBuilder: jest.fn().mockReturnValue(anBuilder) } as never,
      { createQueryBuilder: jest.fn().mockReturnValue(doBuilder) } as never,
      { createQueryBuilder: jest.fn().mockReturnValue(blBuilder) } as never,
    );

    const matches = await service.findDocumentNumberDuplicates(
      BookingDocumentType.ARRIVAL_NOTICE,
      ' same-001 ',
      11,
    );

    expect(bookingBuilder.orderBy).toHaveBeenCalledWith(
      'booking.createdAt',
      'DESC',
    );
    expect(anBuilder.orderBy).toHaveBeenCalledWith('an.createdAt', 'DESC');
    expect(doBuilder.orderBy).toHaveBeenCalledWith(
      'deliveryOrder.createdAt',
      'DESC',
    );
    expect(blBuilder.orderBy).toHaveBeenCalledWith('bl.createdAt', 'DESC');
    expect(anBuilder.andWhere).toHaveBeenCalledWith('an.id <> :excludeId', {
      excludeId: 11,
    });
    expect(bookingBuilder.andWhere).toHaveBeenCalledWith(
      'booking.deleted_at IS NULL',
    );
    expect(anBuilder.andWhere).toHaveBeenCalledWith('an.deleted_at IS NULL');
    expect(doBuilder.andWhere).toHaveBeenCalledWith(
      'deliveryOrder.deleted_at IS NULL',
    );
    expect(blBuilder.andWhere).toHaveBeenCalledWith('bl.deleted_at IS NULL');
    expect(matches).toHaveLength(4);
    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentType: BookingDocumentType.BOOKING_CONFIRMATION,
          bookingId: 10,
          bookingNumber: 'SAME-001',
        }),
        expect.objectContaining({
          documentType: BookingDocumentType.BILL_OF_LADING,
          bookingId: 22,
          bookingNumber: 'BK-BL',
        }),
      ]),
    );
  });
});
