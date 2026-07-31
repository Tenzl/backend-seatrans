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

  it('loads a single document record by id', async () => {
    const getRecord = jest.fn().mockResolvedValue({ id: 9 });
    const controller = new BookingDocumentsAdminController({
      getRecord,
    } as unknown as BookingDocumentsService);

    await controller.getRecord(9);
    expect(getRecord).toHaveBeenCalledWith(9);
  });

  it('updates, locks, unlocks, archives, and permanently deletes records', async () => {
    const updateRecord = jest.fn().mockResolvedValue({ id: 3 });
    const lockRecord = jest.fn().mockResolvedValue({ id: 3, lockedAt: 'x' });
    const unlockRecord = jest.fn().mockResolvedValue({ id: 3, lockedAt: null });
    const archiveRecord = jest.fn().mockResolvedValue(undefined);
    const permanentDeleteRecord = jest.fn().mockResolvedValue(undefined);
    const controller = new BookingDocumentsAdminController({
      updateRecord,
      lockRecord,
      unlockRecord,
      archiveRecord,
      permanentDeleteRecord,
    } as unknown as BookingDocumentsService);

    await controller.updateRecord(
      3,
      { anNumber: 'AN-3', status: 'COMPLETED' },
      { user: { id: 2 } } as never,
    );
    await controller.lockRecord(3, { user: { id: 2 } } as never);
    await controller.unlockRecord(3, { user: { id: 2 } } as never);
    await controller.archiveRecord(3, { user: { id: 2 } } as never);
    await controller.permanentDeleteRecord(3);

    expect(updateRecord).toHaveBeenCalledWith(
      3,
      { anNumber: 'AN-3', status: 'COMPLETED' },
      2,
    );
    expect(lockRecord).toHaveBeenCalledWith(3, 2);
    expect(unlockRecord).toHaveBeenCalledWith(3, 2);
    expect(archiveRecord).toHaveBeenCalledWith(3, 2);
    expect(permanentDeleteRecord).toHaveBeenCalledWith(3);
  });
});
