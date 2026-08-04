import { ConflictException, NotFoundException } from '@nestjs/common';
import { BookingDocumentHistoryService } from './booking-document-history.service';
import { BookingDocumentPayloadValidator } from './booking-document-payload.validator';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingDocumentStatus } from './enums/booking-document-status.enum';
import { BookingDocumentType } from './enums/booking-document-type.enum';
import { BookingFlow } from './enums/booking-flow.enum';
import { BookingDocumentPdfRenderer } from './rendering/booking-document-pdf.renderer';

describe('BookingDocumentHistoryService lifecycle', () => {
  const records = new Map<number, Record<string, unknown>>();
  let nextId = 1;

  const recordRepository = {
    create: jest.fn((value: object) => ({ ...value })),
    save: jest.fn((record: Record<string, unknown>) => {
      const id = Number(record.id ?? nextId++);
      const saved = {
        ...record,
        id,
        createdAt:
          record.createdAt instanceof Date
            ? record.createdAt
            : new Date('2026-07-31T01:00:00.000Z'),
        updatedAt: new Date('2026-07-31T01:05:00.000Z'),
      };
      records.set(id, saved);
      return Promise.resolve(saved);
    }),
    findOne: jest.fn(
      (options: {
        where: {
          id?: number;
          bookingId?: number;
          documentType?: BookingDocumentType;
          deletedAt?: unknown;
        };
        relations?: unknown;
      }) => {
        const row = options.where.id
          ? records.get(options.where.id)
          : [...records.values()].find(
              (candidate) =>
                candidate.bookingId === options.where.bookingId &&
                candidate.documentType === options.where.documentType &&
                candidate.deletedAt == null,
            );
        if (!row) return Promise.resolve(null);
        if (options.where.deletedAt !== undefined && row.deletedAt != null) {
          return Promise.resolve(null);
        }
        return Promise.resolve(row);
      },
    ),
    find: jest.fn((options: { where: { bookingId: number } }) =>
      Promise.resolve(
        [...records.values()].filter(
          (row) =>
            row.bookingId === options.where.bookingId && row.deletedAt == null,
        ),
      ),
    ),
    findAndCount: jest.fn(() => {
      const all = [...records.values()].filter((row) => row.deletedAt == null);
      return Promise.resolve([all, all.length]);
    }),
    remove: jest.fn((record: { id: number }) => {
      records.delete(Number(record.id));
      return Promise.resolve(record);
    }),
  };

  let service: BookingDocumentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    records.clear();
    nextId = 1;
    service = new BookingDocumentsService(
      new BookingDocumentPayloadValidator(),
      new BookingDocumentHistoryService(recordRepository as never),
      new BookingDocumentPdfRenderer(),
    );
  });

  it('creates a PROCESSING draft by default', async () => {
    const result = await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-100' },
      4,
    );

    expect(result).toMatchObject({
      status: BookingDocumentStatus.PROCESSING,
      referenceNumber: 'AN-100',
      lockedAt: null,
      deletedAt: null,
    });
  });

  it('creates a COMPLETED record when status is provided', async () => {
    const result = await service.createRecord(
      BookingDocumentType.DELIVERY_ORDER,
      { doNumber: 'DO-9', status: BookingDocumentStatus.COMPLETED },
      4,
    );

    expect(result.status).toBe(BookingDocumentStatus.COMPLETED);
  });

  it('updates payload and refreshes reference number', async () => {
    const created = await service.createRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      { bookingNumber: 'BK-1', status: BookingDocumentStatus.PROCESSING },
      4,
    );

    const updated = await service.updateRecord(
      created.id,
      { bookingNumber: 'BK-2', status: BookingDocumentStatus.COMPLETED },
      8,
    );

    expect(updated).toMatchObject({
      id: created.id,
      referenceNumber: 'BK-2',
      status: BookingDocumentStatus.COMPLETED,
      updatedByUserId: 8,
    });
  });

  it('rejects update after lock with 409', async () => {
    const created = await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-L' },
      4,
    );
    await service.lockRecord(created.id, 4);

    await expect(
      service.updateRecord(created.id, { anNumber: 'AN-L2' }, 4),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('unlocks a locked record so updates succeed again', async () => {
    const created = await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-U' },
      4,
    );
    await service.lockRecord(created.id, 4);

    const unlocked = await service.unlockRecord(created.id, 9);
    expect(unlocked.lockedAt).toBeNull();
    expect(unlocked.updatedByUserId).toBe(9);

    const updated = await service.updateRecord(
      created.id,
      { anNumber: 'AN-U2' },
      9,
    );
    expect(updated.referenceNumber).toBe('AN-U2');
  });

  it('rejects unlock when the record is not locked', async () => {
    const created = await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-NU' },
      4,
    );

    await expect(service.unlockRecord(created.id, 4)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects duplicate lock', async () => {
    const created = await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-L2' },
      4,
    );
    await service.lockRecord(created.id, 4);

    await expect(service.lockRecord(created.id, 4)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('archives a record and excludes it from the default list', async () => {
    const created = await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-A' },
      4,
    );
    await service.archiveRecord(created.id, 4);

    const listed = await service.listRecords();
    expect(listed.content).toHaveLength(0);
    expect(listed.totalElements).toBe(0);

    await expect(service.getRecord(created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('permanently deletes a record', async () => {
    const created = await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-D' },
      4,
    );
    await service.permanentDeleteRecord(created.id);

    expect(records.has(created.id)).toBe(false);
    await expect(service.getRecord(created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('groups the three allowed documents under an Import booking', async () => {
    const booking = await service.createRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      {
        bookingNumber: 'IMP-1',
        bookingFlow: BookingFlow.IMPORT,
      },
      4,
    );
    const an = await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-1', bookingId: booking.id },
      4,
    );
    const deliveryOrder = await service.createRecord(
      BookingDocumentType.DELIVERY_ORDER,
      { doNumber: 'DO-1', bookingId: booking.id },
      4,
    );

    expect(booking.bookingFlow).toBe(BookingFlow.IMPORT);
    expect(an.bookingId).toBe(booking.id);
    expect(deliveryOrder.bookingId).toBe(booking.id);
    await expect(
      service.createRecord(
        BookingDocumentType.BILL_OF_LADING,
        { fblNumber: 'BL-WRONG', bookingId: booking.id },
        4,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const workflow = await service.getWorkflow(booking.id);
    expect(workflow.flow).toBe(BookingFlow.IMPORT);
    expect(Object.keys(workflow.documents).sort()).toEqual([
      'an',
      'booking',
      'do',
    ]);
  });

  it('prevents duplicate active steps inside one booking', async () => {
    const booking = await service.createRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      { bookingNumber: 'EXP-1', bookingFlow: BookingFlow.EXPORT },
      4,
    );
    await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-1', bookingId: booking.id },
      4,
    );

    await expect(
      service.createRecord(
        BookingDocumentType.ARRIVAL_NOTICE,
        { anNumber: 'AN-2', bookingId: booking.id },
        4,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents child creation and updates while the root booking is locked', async () => {
    const booking = await service.createRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      { bookingNumber: 'EXP-LOCKED', bookingFlow: BookingFlow.EXPORT },
      4,
    );
    const arrivalNotice = await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-LOCKED', bookingId: booking.id },
      4,
    );
    await service.lockRecord(booking.id, 4);

    await expect(
      service.updateRecord(arrivalNotice.id, { anNumber: 'AN-LOCKED-2' }, 4),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.createRecord(
        BookingDocumentType.BILL_OF_LADING,
        { fblNumber: 'BL-LOCKED', bookingId: booking.id },
        4,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('translates a concurrent duplicate-step constraint into conflict', async () => {
    const booking = await service.createRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      { bookingNumber: 'EXP-RACE', bookingFlow: BookingFlow.EXPORT },
      4,
    );
    recordRepository.save.mockRejectedValueOnce({
      driverError: { code: '23505' },
    });

    await expect(
      service.createRecord(
        BookingDocumentType.ARRIVAL_NOTICE,
        { anNumber: 'AN-RACE', bookingId: booking.id },
        4,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
