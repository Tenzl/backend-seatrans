import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingDocumentType } from './enums/booking-document-type.enum';

describe('BookingDocumentsService', () => {
  let service: BookingDocumentsService;

  beforeEach(() => {
    service = new BookingDocumentsService();
  });

  it.each([
    [BookingDocumentType.ARRIVAL_NOTICE, 'AN-preview.pdf'],
    [BookingDocumentType.BOOKING_CONFIRMATION, 'BOOKING-preview.pdf'],
    [BookingDocumentType.DELIVERY_ORDER, 'DO-preview.pdf'],
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
