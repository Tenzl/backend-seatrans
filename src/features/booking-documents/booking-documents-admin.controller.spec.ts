import { BadRequestException, ParseEnumPipe } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
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
      { user: { id: 5 } } as never,
      response as never,
    );

    expect(createPreview).toHaveBeenCalledWith(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-001' },
      5,
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

  it('lists paginated records for the document type in the route', async () => {
    const listRecords = jest.fn().mockResolvedValue({ content: [] });
    const controller = new BookingDocumentsAdminController({
      listRecords,
    } as unknown as BookingDocumentsService);

    await controller.listRecords(
      BookingDocumentType.BOOKING_CONFIRMATION,
      '2',
      '15',
    );

    expect(listRecords).toHaveBeenCalledWith(
      BookingDocumentType.BOOKING_CONFIRMATION,
      2,
      15,
      'active',
    );
  });

  it('loads a single document record by type and id', async () => {
    const getRecord = jest.fn().mockResolvedValue({ id: 9 });
    const controller = new BookingDocumentsAdminController({
      getRecord,
    } as unknown as BookingDocumentsService);

    await controller.getRecord(BookingDocumentType.BILL_OF_LADING, 9);
    expect(getRecord).toHaveBeenCalledWith(
      BookingDocumentType.BILL_OF_LADING,
      9,
    );
  });

  it('updates, locks, unlocks, archives, restores, and permanently deletes records', async () => {
    const updateRecord = jest.fn().mockResolvedValue({ id: 3 });
    const lockRecord = jest.fn().mockResolvedValue({ id: 3, lockedAt: 'x' });
    const unlockRecord = jest.fn().mockResolvedValue({ id: 3, lockedAt: null });
    const archiveRecord = jest.fn().mockResolvedValue(undefined);
    const restoreRecord = jest.fn().mockResolvedValue({ id: 3 });
    const permanentDeleteRecord = jest.fn().mockResolvedValue(undefined);
    const controller = new BookingDocumentsAdminController({
      updateRecord,
      lockRecord,
      unlockRecord,
      archiveRecord,
      restoreRecord,
      permanentDeleteRecord,
    } as unknown as BookingDocumentsService);

    await controller.updateRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      3,
      { anNumber: 'AN-3', expectedVersion: 4 },
      { user: { id: 2 } } as never,
    );
    await controller.lockRecord(BookingDocumentType.ARRIVAL_NOTICE, 3, 5, {
      user: { id: 2 },
    } as never);
    await controller.unlockRecord(BookingDocumentType.ARRIVAL_NOTICE, 3, 6, {
      user: { id: 2 },
    } as never);
    await controller.archiveRecord(BookingDocumentType.ARRIVAL_NOTICE, 3, 7, {
      user: { id: 2 },
    } as never);
    await controller.restoreRecord(BookingDocumentType.ARRIVAL_NOTICE, 3, 8, {
      user: { id: 2 },
    } as never);
    await controller.permanentDeleteRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      3,
    );

    expect(updateRecord).toHaveBeenCalledWith(
      BookingDocumentType.ARRIVAL_NOTICE,
      3,
      { anNumber: 'AN-3', expectedVersion: 4 },
      2,
    );
    expect(lockRecord).toHaveBeenCalledWith(
      BookingDocumentType.ARRIVAL_NOTICE,
      3,
      2,
      5,
    );
    expect(unlockRecord).toHaveBeenCalledWith(
      BookingDocumentType.ARRIVAL_NOTICE,
      3,
      2,
      6,
    );
    expect(archiveRecord).toHaveBeenCalledWith(
      BookingDocumentType.ARRIVAL_NOTICE,
      3,
      2,
      7,
    );
    expect(restoreRecord).toHaveBeenCalledWith(
      BookingDocumentType.ARRIVAL_NOTICE,
      3,
      2,
      8,
    );
    expect(permanentDeleteRecord).toHaveBeenCalledWith(
      BookingDocumentType.ARRIVAL_NOTICE,
      3,
    );
  });

  it('requires the document type in every record route', () => {
    const prototype = BookingDocumentsAdminController.prototype;
    const pathFor = (
      methodName: keyof BookingDocumentsAdminController,
    ): unknown => {
      const method = Object.getOwnPropertyDescriptor(prototype, methodName)
        ?.value as object;
      const path: unknown = Reflect.getMetadata(PATH_METADATA, method);
      return path;
    };

    expect(pathFor('listRecords')).toBe(':type/records');
    expect(pathFor('getRecord')).toBe(':type/records/:id');
    expect(pathFor('previewRecord')).toBe(':type/records/:id/preview');
    expect(pathFor('createRecord')).toBe(':type/records');
    expect(pathFor('updateRecord')).toBe(':type/records/:id');
    expect(pathFor('lockRecord')).toBe(':type/records/:id/lock');
    expect(pathFor('unlockRecord')).toBe(':type/records/:id/unlock');
    expect(pathFor('archiveRecord')).toBe(':type/records/:id');
    expect(pathFor('restoreRecord')).toBe(':type/records/:id/restore');
    expect(pathFor('permanentDeleteRecord')).toBe(
      ':type/records/:id/permanent',
    );
  });

  it('rejects unsupported document types with the route enum parser', async () => {
    const pipe = new ParseEnumPipe(BookingDocumentType);

    await expect(
      pipe.transform('unsupported', {
        type: 'param',
        metatype: String,
        data: 'type',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
