import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { BookingDocumentHistoryService } from './booking-document-history.service';
import { BookingDocumentPayloadValidator } from './booking-document-payload.validator';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingDocumentType } from './enums/booking-document-type.enum';
import { BookingDocumentPdfRenderer } from './rendering/booking-document-pdf.renderer';

describe('BookingDocumentsService', () => {
  let service: BookingDocumentsService;
  const recordRepository = {
    create: jest.fn((value: object) => value),
    save: jest.fn(),
    findAndCount: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BookingDocumentsService(
      new BookingDocumentPayloadValidator(),
      new BookingDocumentHistoryService(recordRepository as never),
      new BookingDocumentPdfRenderer(),
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
      documentType: BookingDocumentType.ARRIVAL_NOTICE,
      referenceNumber: 'AN-001',
      payload: { anNumber: 'AN-001' },
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

  it('returns paginated records newest first', async () => {
    recordRepository.findAndCount.mockResolvedValue([
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

    const result = await service.listRecords(
      BookingDocumentType.DELIVERY_ORDER,
      0,
      10,
    );

    expect(recordRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          documentType: BookingDocumentType.DELIVERY_ORDER,
        }),
        relations: { createdBy: true },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: 0,
        take: 10,
      }),
    );
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
});
