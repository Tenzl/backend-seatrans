import { ConflictException, NotFoundException } from '@nestjs/common';
import { BookingDocumentRecordService } from './booking-document-record.service';
import { BookingDocumentPayloadValidator } from './booking-document-payload.validator';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingDocumentStatus } from './enums/booking-document-status.enum';
import { BookingDocumentType } from './enums/booking-document-type.enum';
import { BookingFlow } from './enums/booking-flow.enum';
import { BookingDocumentPdfRenderer } from './rendering/booking-document-pdf.renderer';

type StoredRecord = Record<string, unknown> & { id: number };

function createRepositoryMock() {
  const records = new Map<number, StoredRecord>();
  let nextId = 1;
  const repository = {
    records,
    create: jest.fn((value: object) => ({ ...value })),
    save: jest.fn((record: Record<string, unknown>) => {
      const id = Number(record.id ?? nextId++);
      const saved = {
        ...record,
        id,
        createdAt:
          record.createdAt instanceof Date
            ? record.createdAt
            : new Date('2026-08-04T01:00:00.000Z'),
        updatedAt: new Date('2026-08-04T01:05:00.000Z'),
      } as StoredRecord;
      records.set(id, saved);
      return Promise.resolve(saved);
    }),
    findOne: jest.fn(
      (options: {
        where: { id?: number; bookingId?: number; deletedAt?: unknown };
      }) => {
        const row = options.where.id
          ? records.get(options.where.id)
          : [...records.values()].find(
              (candidate) =>
                candidate.bookingId === options.where.bookingId &&
                candidate.deletedAt == null,
            );
        if (!row) return Promise.resolve(null);
        if (options.where.deletedAt !== undefined && row.deletedAt != null) {
          return Promise.resolve(null);
        }
        return Promise.resolve(row);
      },
    ),
    find: jest.fn(
      (options: { where: { bookingId?: number; deletedAt?: unknown } }) =>
        Promise.resolve(
          [...records.values()].filter(
            (row) =>
              row.bookingId === options.where.bookingId &&
              row.deletedAt == null,
          ),
        ),
    ),
    findAndCount: jest.fn(() => {
      const active = [...records.values()].filter(
        (row) => row.deletedAt == null,
      );
      return Promise.resolve([active, active.length]);
    }),
    remove: jest.fn((record: StoredRecord) => {
      records.delete(record.id);
      return Promise.resolve(record);
    }),
  };
  return repository;
}

describe('BookingDocumentRecordService lifecycle', () => {
  const bookingRepository = createRepositoryMock();
  const arrivalNoticeRepository = createRepositoryMock();
  const deliveryOrderRepository = createRepositoryMock();
  const billOfLadingRepository = createRepositoryMock();
  let service: BookingDocumentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const repository of [
      bookingRepository,
      arrivalNoticeRepository,
      deliveryOrderRepository,
      billOfLadingRepository,
    ]) {
      repository.records.clear();
    }
    const recordService = new BookingDocumentRecordService(
      bookingRepository as never,
      arrivalNoticeRepository as never,
      deliveryOrderRepository as never,
      billOfLadingRepository as never,
    );
    service = new BookingDocumentsService(
      new BookingDocumentPayloadValidator(),
      recordService,
      new BookingDocumentPdfRenderer(),
    );
  });

  it('stores each type in its own repository and requires the type to read it', async () => {
    const booking = await service.createRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      { bookingNumber: 'BK-1' },
      4,
    );
    const arrivalNotice = await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-1' },
      4,
    );

    expect(booking.id).toBe(1);
    expect(arrivalNotice.id).toBe(1);
    expect(bookingRepository.save).toHaveBeenCalledTimes(1);
    expect(arrivalNoticeRepository.save).toHaveBeenCalledTimes(1);
    await expect(
      service.getRecord(BookingDocumentType.BILL_OF_LADING, booking.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('persists AN billOfLadingType on create', async () => {
    const created = await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-LEGACY', billOfLadingType: 'Surrendered' },
      4,
    );

    expect(created.payload).toMatchObject({
      anNumber: 'AN-LEGACY',
      billOfLadingType: 'Surrendered',
    });
  });

  it('creates drafts, updates, locks, unlocks, archives, and lists by type', async () => {
    const created = await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-100' },
      4,
    );
    expect(created).toMatchObject({
      status: BookingDocumentStatus.PROCESSING,
      referenceNumber: 'AN-100',
    });

    const updated = await service.updateRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      created.id,
      { anNumber: 'AN-101', status: BookingDocumentStatus.COMPLETED },
      8,
    );
    expect(updated).toMatchObject({
      referenceNumber: 'AN-101',
      status: BookingDocumentStatus.COMPLETED,
      updatedByUserId: 8,
    });

    await service.lockRecord(BookingDocumentType.ARRIVAL_NOTICE, created.id, 8);
    await expect(
      service.updateRecord(
        BookingDocumentType.ARRIVAL_NOTICE,
        created.id,
        { anNumber: 'AN-102' },
        8,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await service.unlockRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      created.id,
      9,
    );
    await service.archiveRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      created.id,
      9,
    );

    const listed = await service.listRecords(
      BookingDocumentType.ARRIVAL_NOTICE,
    );
    expect(listed.totalElements).toBe(0);
  });

  it('builds the Import workflow across three physical tables', async () => {
    const booking = await service.createRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      { bookingNumber: 'IMP-1', bookingFlow: BookingFlow.IMPORT },
      4,
    );
    await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-1', bookingId: booking.id },
      4,
    );
    await service.createRecord(
      BookingDocumentType.DELIVERY_ORDER,
      { doNumber: 'DO-1', bookingId: booking.id },
      4,
    );

    const workflow = await service.getWorkflow(booking.id);
    expect(workflow.flow).toBe(BookingFlow.IMPORT);
    expect(Object.keys(workflow.documents).sort()).toEqual([
      'an',
      'booking',
      'do',
    ]);
    await expect(
      service.createRecord(
        BookingDocumentType.BILL_OF_LADING,
        { fblNumber: 'BL-WRONG', bookingId: booking.id },
        4,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires AN before the final document and rejects duplicate active steps', async () => {
    const booking = await service.createRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      { bookingNumber: 'EXP-1', bookingFlow: BookingFlow.EXPORT },
      4,
    );
    await expect(
      service.createRecord(
        BookingDocumentType.BILL_OF_LADING,
        { fblNumber: 'BL-EARLY', bookingId: booking.id },
        4,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

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
      { bookingNumber: 'EXP-LOCK', bookingFlow: BookingFlow.EXPORT },
      4,
    );
    const arrivalNotice = await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-LOCK', bookingId: booking.id },
      4,
    );
    await service.lockRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      booking.id,
      4,
    );

    await expect(
      service.updateRecord(
        BookingDocumentType.ARRIVAL_NOTICE,
        arrivalNotice.id,
        { anNumber: 'AN-LOCK-2' },
        4,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.createRecord(
        BookingDocumentType.BILL_OF_LADING,
        { fblNumber: 'BL-LOCK', bookingId: booking.id },
        4,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('translates a concurrent unique constraint failure into conflict', async () => {
    const booking = await service.createRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      { bookingNumber: 'EXP-RACE', bookingFlow: BookingFlow.EXPORT },
      4,
    );
    arrivalNoticeRepository.save.mockRejectedValueOnce({
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

  it('permanently deletes from only the selected table', async () => {
    const record = await service.createRecord(
      BookingDocumentType.BILL_OF_LADING,
      { fblNumber: 'BL-DELETE' },
      4,
    );
    await service.permanentDeleteRecord(
      BookingDocumentType.BILL_OF_LADING,
      record.id,
    );
    expect(billOfLadingRepository.records.size).toBe(0);
  });
});
