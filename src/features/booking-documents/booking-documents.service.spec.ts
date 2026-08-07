import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
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
  };
  const userRepository = {
    findOne: jest.fn().mockResolvedValue(null),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    userRepository.findOne.mockResolvedValue(null);
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

  it('overwrites BL cargo from the linked Arrival Notice on save', async () => {
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
        status: 'COMPLETED',
      },
      9,
    );

    expect(result.payload).toMatchObject({
      fblNumber: 'BL-OLD',
      consignor: 'SHIPPER KEEP',
      shippingMark: 'KEEP MARK',
      descriptionOfGoods: 'AN STONE',
      serviceMode: 'FCL/FCL - CY/CY',
      numberAndKindOfPackages: '2',
      grossWeight: '900',
      measurement: '12',
      containers: [
        expect.objectContaining({
          containerNo: 'C1',
          sealNo: 'S1',
          type: "20'DC",
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
        status: 'COMPLETED',
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
      Array.from({ length: 9 }, (_, index) =>
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
  });

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

    const updated = await service.updateRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      7,
      {
        bookingNumber: 'BK-2',
        pic: 'Selected User, Email: selected@seatrans.com.vn',
      },
      12,
    );
    expect(updated.payload).toMatchObject({
      pic: 'Selected User, Email: selected@seatrans.com.vn',
    });
  });
});
