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
});
