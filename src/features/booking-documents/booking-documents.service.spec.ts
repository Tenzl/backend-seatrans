/* eslint-disable @typescript-eslint/no-unsafe-return */
import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { syncDeliveryOrderCargoFromArrivalNotice } from './an-container';
import { BILL_OF_LADING_TEMPLATE_BY_VARIANT } from './constants/booking-document.constants';
import { BookingDocumentRecordService } from './booking-document-record.service';
import { BookingDocumentPayloadValidator } from './booking-document-payload.validator';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingDocumentType } from './enums/booking-document-type.enum';
import { BookingDocumentPdfRenderer } from './rendering/booking-document-pdf.renderer';

describe('BookingDocumentsService', () => {
  let service: BookingDocumentsService;
  const recordRepository = {
    create: jest.fn((value: object) => value),
    save: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    createQueryBuilder: jest.fn(() => {
      let changes: Record<string, unknown> = {};
      let id = 0;
      let expectedVersion = 0;
      const builder = {
        update: jest.fn(() => builder),
        set: jest.fn((value: Record<string, unknown>) => {
          changes = value;
          return builder;
        }),
        where: jest.fn((_sql: string, params: { id: number }) => {
          id = params.id;
          return builder;
        }),
        andWhere: jest.fn(
          (_sql: string, params?: { expectedVersion?: number }) => {
            if (params?.expectedVersion != null) {
              expectedVersion = params.expectedVersion;
            }
            return builder;
          },
        ),
        execute: jest.fn(async () => {
          const row = (await recordRepository.findOne({
            where: { id },
          })) as Record<string, unknown> | null;
          if (!row || Number(row.version ?? 1) !== expectedVersion) {
            return { affected: 0 };
          }
          Object.assign(row, changes, {
            version: expectedVersion + 1,
            updatedAt: new Date('2026-07-29T11:01:00.000Z'),
          });
          return { affected: 1 };
        }),
      };
      return builder;
    }),
  };
  const userRepository = {
    findOne: jest.fn().mockResolvedValue(null),
  };
  const dataSource = {
    transaction: jest.fn(
      async <T>(work: (manager: undefined) => Promise<T>): Promise<T> =>
        work(undefined),
    ),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    userRepository.findOne.mockResolvedValue(null);
    dataSource.transaction.mockImplementation(
      async <T>(work: (manager: undefined) => Promise<T>): Promise<T> =>
        work(undefined),
    );
    service = new BookingDocumentsService(
      new BookingDocumentPayloadValidator(),
      new BookingDocumentRecordService(
        recordRepository as never,
        recordRepository as never,
        recordRepository as never,
        recordRepository as never,
      ),
      new BookingDocumentPdfRenderer(),
      userRepository as never,
      dataSource as never,
    );
  });

  it('creates an immutable history record from the validated payload', async () => {
    recordRepository.save.mockImplementation(
      (record: object): Promise<object> =>
        Promise.resolve({
          ...record,
          id: 41,
          createdAt: new Date('2026-07-29T10:00:00.000Z'),
          updatedAt: new Date('2026-07-29T10:00:00.000Z'),
          lockedAt: null,
          deletedAt: null,
        }),
    );

    const result = await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-001' },
      9,
    );

    expect(recordRepository.create).toHaveBeenCalledWith({
      bookingId: null,
      payload: {
        anNumber: 'AN-001',
        containers: [],
        cargoRows: [],
        descriptionOfGoods: '',
      },
      status: 'PROCESSING',
      createdByUserId: 9,
      updatedByUserId: 9,
    });
    expect(result).toMatchObject({
      id: 41,
      documentType: BookingDocumentType.ARRIVAL_NOTICE,
      referenceNumber: 'AN-001',
      payload: { anNumber: 'AN-001' },
      status: 'PROCESSING',
      createdByUserId: 9,
      createdAt: '2026-07-29T10:00:00.000Z',
    });
  });

  it('does not overwrite BL cargo from the linked Arrival Notice on save', async () => {
    const anPayload = {
      marks: 'AN MARKS',
      descriptionOfGoods: 'AN STONE',
      serviceMode: 'FCL/FCL - CY/CY',
      volume: "1 x 20'DC",
      containers: [
        {
          type: "20'DC",
          containerNo: 'C1',
          sealNo: 'S1',
          grossWeight: '900',
          measurement: '12',
          tare: '',
          packageType: '',
          noOfPkgs: '2',
          note: '',
          method: '',
        },
      ],
      cargoRows: [],
    };
    const blRecord = {
      id: 70,
      bookingId: 5,
      payload: {
        fblNumber: 'BL-OLD',
        containers: [],
        descriptionOfGoods: 'CLIENT DIVERGENT',
        serviceMode: 'CLIENT MODE',
      },
      status: 'COMPLETED',
      createdByUserId: 1,
      createdAt: new Date('2026-07-29T10:00:00.000Z'),
      updatedAt: new Date('2026-07-29T10:00:00.000Z'),
      lockedAt: null,
      deletedAt: null,
    };
    const anRecord = {
      id: 60,
      bookingId: 5,
      payload: anPayload,
      status: 'COMPLETED',
      createdByUserId: 1,
      createdAt: new Date('2026-07-29T09:00:00.000Z'),
      updatedAt: new Date('2026-07-29T09:00:00.000Z'),
      lockedAt: null,
      deletedAt: null,
    };
    const bookingRecord = {
      id: 5,
      bookingFlow: 'EXPORT',
      payload: {},
      status: 'COMPLETED',
      createdByUserId: 1,
      createdAt: new Date('2026-07-29T08:00:00.000Z'),
      updatedAt: new Date('2026-07-29T08:00:00.000Z'),
      lockedAt: null,
      deletedAt: null,
    };
    recordRepository.findOne.mockImplementation(
      (options: { where?: { id?: number; bookingId?: number } }) => {
        const where = options.where ?? {};
        if (where.id === 70) return Promise.resolve(blRecord);
        if (where.id === 5) return Promise.resolve(bookingRecord);
        if (where.bookingId === 5) return Promise.resolve(anRecord);
        return Promise.resolve(null);
      },
    );
    recordRepository.save.mockImplementation(
      (record: object): Promise<object> =>
        Promise.resolve({
          ...record,
          id: 70,
          bookingId: 5,
          createdAt: new Date('2026-07-29T10:00:00.000Z'),
          updatedAt: new Date('2026-07-29T11:00:00.000Z'),
          lockedAt: null,
          deletedAt: null,
        }),
    );

    const result = await service.updateRecord(
      BookingDocumentType.BILL_OF_LADING,
      70,
      {
        expectedVersion: 1,
        fblNumber: 'BL-OLD',
        consignor: 'SHIPPER KEEP',
        descriptionOfGoods: 'CLIENT DIVERGENT',
        serviceMode: 'CLIENT MODE',
        shippingMark: 'KEEP MARK',
        containers: [
          {
            type: "40'HC",
            containerNo: 'WRONG',
            sealNo: '',
            grossWeight: '1',
            measurement: '1',
            tare: '',
            packageType: '',
            noOfPkgs: '1',
            note: '',
            method: '',
          },
        ],
      },
      9,
    );

    expect(result.payload).toMatchObject({
      fblNumber: 'BL-OLD',
      consignor: 'SHIPPER KEEP',
      shippingMark: 'KEEP MARK',
      descriptionOfGoods: 'CLIENT DIVERGENT',
      serviceMode: 'CLIENT MODE',
      containers: [
        expect.objectContaining({
          containerNo: 'WRONG',
          type: "40'HC",
        }),
      ],
    });
  });

  it('overwrites DO cargo/containers from the linked Arrival Notice on save', async () => {
    const anPayload = {
      marks: 'AN MARKS',
      descriptionOfGoods: 'AN STONE',
      serviceMode: 'FCL/FCL - CY/CY',
      volume: "1 x 20'DC",
      containers: [
        {
          type: "20'DC",
          containerNo: 'C1',
          sealNo: 'S1',
          grossWeight: '900',
          measurement: '12',
          tare: '',
          packageType: '',
          noOfPkgs: '2',
          note: '',
          method: '',
        },
      ],
      cargoRows: [],
    };
    const doRecord = {
      id: 71,
      bookingId: 6,
      payload: {
        doNumber: 'DO-OLD',
        containers: [],
        cargoRows: [],
        serviceMode: 'CLIENT MODE',
        descriptionOfGoods: 'CLIENT DIVERGENT',
      },
      status: 'COMPLETED',
      createdByUserId: 1,
      createdAt: new Date('2026-07-29T10:00:00.000Z'),
      updatedAt: new Date('2026-07-29T10:00:00.000Z'),
      lockedAt: null,
      deletedAt: null,
    };
    const anRecord = {
      id: 61,
      bookingId: 6,
      payload: anPayload,
      status: 'COMPLETED',
      createdByUserId: 1,
      createdAt: new Date('2026-07-29T09:00:00.000Z'),
      updatedAt: new Date('2026-07-29T09:00:00.000Z'),
      lockedAt: null,
      deletedAt: null,
    };
    const bookingRecord = {
      id: 6,
      bookingFlow: 'IMPORT',
      payload: {},
      status: 'COMPLETED',
      createdByUserId: 1,
      createdAt: new Date('2026-07-29T08:00:00.000Z'),
      updatedAt: new Date('2026-07-29T08:00:00.000Z'),
      lockedAt: null,
      deletedAt: null,
    };
    recordRepository.findOne.mockImplementation(
      (options: { where?: { id?: number; bookingId?: number } }) => {
        const where = options.where ?? {};
        if (where.id === 71) return Promise.resolve(doRecord);
        if (where.id === 6) return Promise.resolve(bookingRecord);
        if (where.bookingId === 6) return Promise.resolve(anRecord);
        return Promise.resolve(null);
      },
    );
    recordRepository.save.mockImplementation(
      (record: object): Promise<object> =>
        Promise.resolve({
          ...record,
          id: 71,
          bookingId: 6,
          createdAt: new Date('2026-07-29T10:00:00.000Z'),
          updatedAt: new Date('2026-07-29T11:00:00.000Z'),
          lockedAt: null,
          deletedAt: null,
        }),
    );

    const result = await service.updateRecord(
      BookingDocumentType.DELIVERY_ORDER,
      71,
      {
        expectedVersion: 1,
        doNumber: 'DO-OLD',
        deliverTo: 'CONSIGNEE KEEP',
        serviceMode: 'CLIENT MODE',
        descriptionOfGoods: 'CLIENT DIVERGENT',
        containers: [
          {
            type: "40'HC",
            containerNo: 'WRONG',
            sealNo: '',
            grossWeight: '1',
            measurement: '1',
            tare: '',
            packageType: '',
            noOfPkgs: '1',
            note: '',
            method: '',
          },
        ],
      },
      9,
    );

    expect(result.payload).toMatchObject({
      doNumber: 'DO-OLD',
      deliverTo: 'CONSIGNEE KEEP',
      serviceMode: 'FCL/FCL - CY/CY',
      descriptionOfGoods: 'AN STONE',
      containers: [
        expect.objectContaining({
          containerNo: 'C1',
          sealNo: 'S1',
          type: "20'DC",
        }),
      ],
    });
  });

  it('returns paginated records newest first', async () => {
    let findOptions: unknown;
    recordRepository.findAndCount.mockImplementation((options: unknown) => {
      findOptions = options;
      return Promise.resolve([
        [
          {
            id: 8,
            documentType: BookingDocumentType.DELIVERY_ORDER,
            referenceNumber: 'DO-008',
            payload: { doNumber: 'DO-008' },
            status: 'COMPLETED',
            createdByUserId: 3,
            createdAt: new Date('2026-07-29T09:00:00.000Z'),
            updatedAt: new Date('2026-07-29T09:00:00.000Z'),
            lockedAt: null,
            deletedAt: null,
            createdBy: {
              id: 3,
              fullName: 'Operator',
              email: 'operator@seatrans.test',
            },
          },
        ],
        1,
      ]);
    });

    const result = await service.listRecords(
      BookingDocumentType.DELIVERY_ORDER,
      0,
      10,
    );

    expect(recordRepository.findAndCount).toHaveBeenCalledTimes(1);
    expect(findOptions).toMatchObject({
      relations: { createdBy: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: 0,
      take: 10,
    });
    expect(
      (findOptions as { where?: { deletedAt?: unknown } }).where?.deletedAt,
    ).toBeDefined();
    expect(result).toMatchObject({
      totalElements: 1,
      totalPages: 1,
      size: 10,
      number: 0,
      content: [
        {
          id: 8,
          referenceNumber: 'DO-008',
          status: 'COMPLETED',
          createdBy: {
            id: 3,
            fullName: 'Operator',
          },
        },
      ],
    });
  });

  it.each([
    [BookingDocumentType.ARRIVAL_NOTICE, 'AN-preview.pdf'],
    [BookingDocumentType.BOOKING_CONFIRMATION, 'BOOKING-preview.pdf'],
    [BookingDocumentType.DELIVERY_ORDER, 'DO-preview.pdf'],
    [BookingDocumentType.BILL_OF_LADING, 'BL-preview.pdf'],
  ])('renders a valid %s PDF with a fixed filename', async (type, filename) => {
    const result = await service.createPreview(type, {});

    expect(result.filename).toBe(filename);
    expect(result.data.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const pdf = await PDFDocument.load(result.data);
    expect(pdf.getPageCount()).toBe(1);
  });

  it('renders a saved record from its stored snapshot without resolving master data again', async () => {
    const storedPayload = {
      bookingNumber: 'BK-SNAPSHOT',
      clientPartyId: 12,
      to: 'Original client name',
      pic: 'Original PIC',
    };
    const validator = {
      validate: jest.fn().mockRejectedValue(new Error('must not resolve')),
    };
    const recordService = {
      getById: jest.fn().mockResolvedValue({ payload: storedPayload }),
    };
    const renderer = {
      render: jest.fn().mockResolvedValue({
        data: Buffer.from('%PDF-snapshot'),
        filename: 'BOOKING-preview.pdf',
      }),
    };
    const snapshotService = new BookingDocumentsService(
      validator as never,
      recordService as never,
      renderer as never,
      userRepository as never,
      dataSource as never,
    );

    await snapshotService.createRecordPreview(
      BookingDocumentType.BOOKING_CONFIRMATION,
      41,
    );

    expect(validator.validate).not.toHaveBeenCalled();
    expect(renderer.render).toHaveBeenCalledWith(
      BookingDocumentType.BOOKING_CONFIRMATION,
      storedPayload,
    );
  });

  it('builds Surrendered from the Original blank', async () => {
    expect(BILL_OF_LADING_TEMPLATE_BY_VARIANT.surrendered).toBe(
      BILL_OF_LADING_TEMPLATE_BY_VARIANT.original,
    );

    const result = await service.createPreview(
      BookingDocumentType.BILL_OF_LADING,
      { blFormVariant: 'surrendered' },
    );
    await expect(PDFDocument.load(result.data)).resolves.toBeDefined();
  });

  it('embeds Vietnamese Unicode text', async () => {
    const result = await service.createPreview(
      BookingDocumentType.ARRIVAL_NOTICE,
      {
        shipper: 'Công ty vận tải Đông Nam Á',
        notifyParty: 'Phường Quy Nhơn, tỉnh Gia Lai, Việt Nam',
      },
    );

    await expect(PDFDocument.load(result.data)).resolves.toBeDefined();
  });

  it('rejects fields that do not belong to the selected document type', async () => {
    await expect(
      service.createPreview(BookingDocumentType.BOOKING_CONFIRMATION, {
        anNumber: 'AN-001',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects client-authored status metadata', async () => {
    await expect(
      service.createRecord(
        BookingDocumentType.ARRIVAL_NOTICE,
        { anNumber: 'AN-001', status: 'COMPLETED' },
        9,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects more than 20 cargo rows', async () => {
    await expect(
      service.createPreview(BookingDocumentType.DELIVERY_ORDER, {
        cargoRows: Array.from({ length: 21 }, () => ({ quantity: '1' })),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adds cargo continuation pages without dropping rows', async () => {
    const result = await service.createPreview(
      BookingDocumentType.DELIVERY_ORDER,
      {
        cargoRows: Array.from({ length: 20 }, (_, index) => ({
          containerSealNumber: `CONT-${index + 1}`,
          quantity: '1',
          descriptionOfGoods: 'Hàng hóa',
        })),
      },
    );

    const pdf = await PDFDocument.load(result.data);
    expect(pdf.getPageCount()).toBe(3);
  });

  it('renders concurrent previews without sharing mutable PDF state', async () => {
    const previews = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        service.createPreview(
          [
            BookingDocumentType.ARRIVAL_NOTICE,
            BookingDocumentType.BOOKING_CONFIRMATION,
            BookingDocumentType.DELIVERY_ORDER,
          ][index % 3],
          {},
        ),
      ),
    );

    for (const preview of previews) {
      await expect(PDFDocument.load(preview.data)).resolves.toBeDefined();
    }
  }, 15_000);

  it('fills booking PIC from creator when empty, keeps selected PIC on update', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 9,
      fullName: 'Nhung Nguyen',
      email: 'total.logistics@seatrans.com.vn',
    });
    recordRepository.save.mockImplementation(
      (record: object): Promise<object> =>
        Promise.resolve({
          ...record,
          id: 7,
          createdAt: new Date('2026-07-29T10:00:00.000Z'),
          updatedAt: new Date('2026-07-29T10:00:00.000Z'),
          lockedAt: null,
          deletedAt: null,
        }),
    );
    recordRepository.findOne.mockResolvedValue({
      id: 7,
      payload: { bookingNumber: 'BK-1', pic: 'Legacy PIC' },
      status: 'PROCESSING',
      createdByUserId: 9,
      createdAt: new Date('2026-07-29T10:00:00.000Z'),
      updatedAt: new Date('2026-07-29T10:00:00.000Z'),
      lockedAt: null,
      deletedAt: null,
    });

    const created = await service.createRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      { bookingNumber: 'BK-1' },
      9,
    );
    expect(created.payload).toMatchObject({
      pic: 'Nhung Nguyen, Email: total.logistics@seatrans.com.vn',
    });

    const legacyUpdated = await service.updateRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      7,
      {
        expectedVersion: 1,
        bookingNumber: 'BK-2',
      },
      12,
    );
    expect(legacyUpdated.payload).toMatchObject({ pic: 'Legacy PIC' });
    expect(legacyUpdated.payload).not.toHaveProperty('picUserId');

    const updated = await service.updateRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      7,
      {
        expectedVersion: legacyUpdated.version,
        bookingNumber: 'BK-3',
        picUserId: 12,
      },
      12,
    );
    expect(updated.payload).toMatchObject({ picUserId: 12 });
  });

  it('runs Arrival Notice create and sibling DO patch inside one transaction', async () => {
    const recordService = {
      create: jest.fn().mockResolvedValue({
        id: 60,
        documentType: BookingDocumentType.ARRIVAL_NOTICE,
        bookingId: 5,
      }),
      findActiveByBookingId: jest.fn().mockResolvedValueOnce({
        id: 71,
        lockedAt: null,
        payload: { doNumber: 'DO-1', containers: [], cargoRows: [] },
      }),
      update: jest.fn().mockResolvedValue({}),
    };
    let committed = false;
    const txDataSource = {
      transaction: jest.fn(
        async <T>(
          work: (manager: { tag: string }) => Promise<T>,
        ): Promise<T> => {
          const result = await work({ tag: 'tx-manager' });
          committed = true;
          return result;
        },
      ),
    };
    const txService = new BookingDocumentsService(
      new BookingDocumentPayloadValidator(),
      recordService as never,
      new BookingDocumentPdfRenderer(),
      userRepository as never,
      txDataSource as never,
    );

    await txService.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      {
        anNumber: 'AN-TX',
        bookingId: 5,
        descriptionOfGoods: 'STONE',
        containers: [],
      },
      9,
    );

    expect(txDataSource.transaction).toHaveBeenCalledTimes(1);
    expect(recordService.create).toHaveBeenCalledWith(
      BookingDocumentType.ARRIVAL_NOTICE,
      expect.any(Object),
      9,
      { bookingFlow: undefined, bookingId: 5 },
      { tag: 'tx-manager' },
    );
    expect(recordService.update).toHaveBeenCalledTimes(1);
    expect(recordService.update).toHaveBeenCalledWith(
      BookingDocumentType.DELIVERY_ORDER,
      71,
      expect.any(Object),
      9,
      undefined,
      { tag: 'tx-manager' },
    );
    expect(committed).toBe(true);
  });

  it('does not commit when a sibling DO patch fails after Arrival Notice write', async () => {
    const recordService = {
      create: jest.fn().mockResolvedValue({
        id: 60,
        documentType: BookingDocumentType.ARRIVAL_NOTICE,
        bookingId: 5,
      }),
      findActiveByBookingId: jest.fn().mockResolvedValueOnce({
        id: 71,
        lockedAt: null,
        payload: { doNumber: 'DO-1', containers: [], cargoRows: [] },
      }),
      update: jest.fn().mockRejectedValueOnce(new Error('sibling patch fault')),
    };
    let committed = false;
    const txDataSource = {
      transaction: jest.fn(
        async <T>(
          work: (manager: { tag: string }) => Promise<T>,
        ): Promise<T> => {
          const result = await work({ tag: 'tx-manager' });
          committed = true;
          return result;
        },
      ),
    };
    const txService = new BookingDocumentsService(
      new BookingDocumentPayloadValidator(),
      recordService as never,
      new BookingDocumentPdfRenderer(),
      userRepository as never,
      txDataSource as never,
    );

    await expect(
      txService.createRecord(
        BookingDocumentType.ARRIVAL_NOTICE,
        {
          anNumber: 'AN-ROLLBACK',
          bookingId: 5,
          descriptionOfGoods: 'STONE',
          containers: [],
        },
        9,
      ),
    ).rejects.toThrow('sibling patch fault');
    expect(committed).toBe(false);
    expect(recordService.create).toHaveBeenCalledTimes(1);
    expect(recordService.update).toHaveBeenCalledTimes(1);
  });

  it('allows a non-cargo AN save when the locked DO cargo projection is unchanged', async () => {
    const anPayload = (await new BookingDocumentPayloadValidator().validate(
      BookingDocumentType.ARRIVAL_NOTICE,
      {
        anNumber: 'AN-LOCKED-DO',
        descriptionOfGoods: 'STONE',
        serviceMode: 'FCL/FCL - CY/CY',
        containers: [{ type: "20'DC", containerNo: 'CONT-1' }],
      },
    )) as never;
    const doPayload = syncDeliveryOrderCargoFromArrivalNotice(anPayload, {
      doNumber: 'DO-LOCKED',
    });
    const recordService = {
      create: jest.fn().mockResolvedValue({ id: 60, bookingId: 5 }),
      findActiveByBookingId: jest.fn().mockResolvedValue({
        id: 71,
        version: 3,
        lockedAt: new Date('2026-08-10T00:00:00.000Z'),
        payload: { ...doPayload, cargoRows: [{ quantity: 'legacy-derived' }] },
      }),
      update: jest.fn(),
    };
    const txService = new BookingDocumentsService(
      new BookingDocumentPayloadValidator(),
      recordService as never,
      new BookingDocumentPdfRenderer(),
      userRepository as never,
      dataSource as never,
    );

    await expect(
      txService.createRecord(
        BookingDocumentType.ARRIVAL_NOTICE,
        { ...anPayload, bookingId: 5, note: 'non-cargo edit' },
        9,
      ),
    ).resolves.toMatchObject({ id: 60 });
    expect(recordService.update).not.toHaveBeenCalled();
  });

  it('rejects an AN cargo change that would drift from a locked DO', async () => {
    const oldAn = (await new BookingDocumentPayloadValidator().validate(
      BookingDocumentType.ARRIVAL_NOTICE,
      {
        descriptionOfGoods: 'STONE',
        serviceMode: 'FCL/FCL - CY/CY',
        containers: [{ type: "20'DC", containerNo: 'CONT-1' }],
      },
    )) as never;
    const recordService = {
      create: jest.fn().mockResolvedValue({ id: 60, bookingId: 5 }),
      findActiveByBookingId: jest.fn().mockResolvedValue({
        id: 71,
        version: 3,
        lockedAt: new Date('2026-08-10T00:00:00.000Z'),
        payload: syncDeliveryOrderCargoFromArrivalNotice(oldAn, {
          doNumber: 'DO-LOCKED',
        }),
      }),
      update: jest.fn(),
    };
    const txService = new BookingDocumentsService(
      new BookingDocumentPayloadValidator(),
      recordService as never,
      new BookingDocumentPdfRenderer(),
      userRepository as never,
      dataSource as never,
    );

    await expect(
      txService.createRecord(
        BookingDocumentType.ARRIVAL_NOTICE,
        {
          bookingId: 5,
          descriptionOfGoods: 'COAL',
          serviceMode: 'FCL/FCL - CY/CY',
          containers: [{ type: "40'HC", containerNo: 'CONT-2' }],
        },
        9,
      ),
    ).rejects.toThrow(
      'Arrival Notice cargo cannot change while the linked Delivery Order is locked',
    );
    expect(recordService.update).not.toHaveBeenCalled();
  });
});
