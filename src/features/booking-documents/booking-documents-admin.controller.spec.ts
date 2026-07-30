import { BOOKING_DOCUMENT_SECTION } from './constants/booking-document.constants';
import { BookingDocumentsAdminController } from './booking-documents-admin.controller';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingDocumentType } from './enums/booking-document-type.enum';

describe('BookingDocumentsAdminController', () => {
  it('is protected by the booking-documents section', () => {
    expect(
      Reflect.getMetadata('section', BookingDocumentsAdminController),
    ).toEqual([BOOKING_DOCUMENT_SECTION]);
  });

  it('sends a non-cacheable inline PDF response', async () => {
    const createPreview = jest.fn().mockResolvedValue({
      data: Buffer.from('%PDF-test'),
      filename: 'AN-preview.pdf',
    });
    const controller = new BookingDocumentsAdminController({
      createPreview,
    } as unknown as BookingDocumentsService);
    const response = {
      set: jest.fn(),
      send: jest.fn(),
    };

    await controller.preview(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-001' },
      response as never,
    );

    expect(createPreview).toHaveBeenCalledWith(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-001' },
    );
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="AN-preview.pdf"',
        'Cache-Control': 'no-store, private',
      }),
    );
    expect(response.send).toHaveBeenCalledWith(Buffer.from('%PDF-test'));
  });

  it('creates a document record for the authenticated staff user', async () => {
    const createRecord = jest.fn().mockResolvedValue({ id: 12 });
    const controller = new BookingDocumentsAdminController({
      createRecord,
    } as unknown as BookingDocumentsService);

    await controller.createRecord(
      BookingDocumentType.DELIVERY_ORDER,
      { doNumber: 'DO-012' },
      { user: { id: 7 } } as never,
    );

    expect(createRecord).toHaveBeenCalledWith(
      BookingDocumentType.DELIVERY_ORDER,
      { doNumber: 'DO-012' },
      7,
    );
  });

  it('lists paginated document history', async () => {
    const listRecords = jest.fn().mockResolvedValue({ content: [] });
    const controller = new BookingDocumentsAdminController({
      listRecords,
    } as unknown as BookingDocumentsService);

    await controller.history('booking', '2', '15');

    expect(listRecords).toHaveBeenCalledWith(
      BookingDocumentType.BOOKING_CONFIRMATION,
      2,
      15,
    );
  });
});
