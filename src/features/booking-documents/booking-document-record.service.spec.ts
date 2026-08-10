/* eslint-disable @typescript-eslint/no-unsafe-return */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BookingDocumentRecordService } from './booking-document-record.service';
import { BookingDocumentPayloadValidator } from './booking-document-payload.validator';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingDocumentStatus } from './enums/booking-document-status.enum';
import { BookingDocumentType } from './enums/booking-document-type.enum';
import { BookingFlow } from './enums/booking-flow.enum';
import { BookingDocumentPdfRenderer } from './rendering/booking-document-pdf.renderer';

type StoredRecord = Record<string, unknown> & { id: number };

function matchesDeletedAtFilter(row: StoredRecord, filter: unknown): boolean {
  if (filter === undefined) return true;
  if (!filter || typeof filter !== 'object' || !('_type' in filter))
    return true;
  if (filter._type === 'isNull') return row.deletedAt == null;
  if (filter._type === 'not') return row.deletedAt != null;
  return true;
}

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
        version: Number(record.version ?? 1),
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
    findAndCount: jest.fn(
      (options: { where?: { deletedAt?: unknown } } = {}) => {
        const matched = [...records.values()].filter((row) =>
          matchesDeletedAtFilter(row, options.where?.deletedAt),
        );
        return Promise.resolve([matched, matched.length]);
      },
    ),
    remove: jest.fn((record: StoredRecord) => {
      records.delete(record.id);
      return Promise.resolve(record);
    }),
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
        execute: jest.fn(() => {
          const row = records.get(id);
          if (!row || Number(row.version) !== expectedVersion) {
            return Promise.resolve({ affected: 0 });
          }
          const resolved = Object.fromEntries(
            Object.entries(changes)
              .filter(([key]) => key !== 'version')
              .map(([key, value]) => [key, value]),
          );
          Object.assign(row, resolved, {
            version: expectedVersion + 1,
            updatedAt: new Date('2026-08-04T01:06:00.000Z'),
          });
          return Promise.resolve({ affected: 1 });
        }),
      };
      return builder;
    }),
  };
  return repository;
}

describe('BookingDocumentRecordService lifecycle', () => {
  const bookingRepository = createRepositoryMock();
  const arrivalNoticeRepository = createRepositoryMock();
  const deliveryOrderRepository = createRepositoryMock();
  const billOfLadingRepository = createRepositoryMock();
  const userRepository = {
    findOne: jest.fn().mockResolvedValue(null),
  };
  const dataSource = {
    transaction: jest.fn(
      async <T>(work: (manager: undefined) => Promise<T>): Promise<T> =>
        work(undefined),
    ),
  };
  let service: BookingDocumentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    userRepository.findOne.mockResolvedValue(null);
    dataSource.transaction.mockImplementation(
      async <T>(work: (manager: undefined) => Promise<T>): Promise<T> =>
        work(undefined),
    );
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
      userRepository as never,
      dataSource as never,
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
      {
        expectedVersion: created.version,
        anNumber: 'AN-101',
        date: '2026-08-04',
        agent: 'Agent',
        shipper: 'Shipper',
        consignee: 'Consignee',
        vesselVoyage: 'Vessel / V1',
        eta: '2026-08-10',
        portOfDischarge: 'QNH',
        descriptionOfGoods: 'Stone',
        containers: [{ containerNo: 'CONT-1' }],
      },
      8,
    );
    expect(updated).toMatchObject({
      referenceNumber: 'AN-101',
      status: BookingDocumentStatus.COMPLETED,
      updatedByUserId: 8,
    });

    const locked = await service.lockRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      created.id,
      8,
      updated.version,
    );
    await expect(
      service.updateRecord(
        BookingDocumentType.ARRIVAL_NOTICE,
        created.id,
        { anNumber: 'AN-102', expectedVersion: locked.version },
        8,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const unlocked = await service.unlockRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      created.id,
      9,
      locked.version,
    );
    const archived = await service.archiveRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      created.id,
      9,
      unlocked.version,
    );
    expect(archived.deletedAt).not.toBeNull();

    const listed = await service.listRecords(
      BookingDocumentType.ARRIVAL_NOTICE,
    );
    expect(listed.totalElements).toBe(0);

    const archivedList = await service.listRecords(
      BookingDocumentType.ARRIVAL_NOTICE,
      0,
      10,
      'archived',
    );
    expect(archivedList.totalElements).toBe(1);

    const restored = await service.restoreRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      created.id,
      10,
      archived.version,
    );
    expect(restored.deletedAt).toBeNull();
    expect(restored.deletedByUserId).toBeNull();

    const activeAfterRestore = await service.listRecords(
      BookingDocumentType.ARRIVAL_NOTICE,
    );
    expect(activeAfterRestore.totalElements).toBe(1);
  });

  it('derives status on the server and rejects locking an incomplete document', async () => {
    const created = await service.createRecord(
      BookingDocumentType.ARRIVAL_NOTICE,
      { anNumber: 'AN-INCOMPLETE' },
      4,
    );

    expect(created.status).toBe(BookingDocumentStatus.PROCESSING);
    await expect(
      service.lockRecord(
        BookingDocumentType.ARRIVAL_NOTICE,
        created.id,
        4,
        created.version,
      ),
    ).rejects.toThrow('Document is incomplete');
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

  it('export workflow is booking then BL; rejects AN and duplicate BL', async () => {
    const booking = await service.createRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      { bookingNumber: 'EXP-1', bookingFlow: BookingFlow.EXPORT },
      4,
    );
    const billOfLading = await service.createRecord(
      BookingDocumentType.BILL_OF_LADING,
      { fblNumber: 'BL-1', bookingId: booking.id },
      4,
    );
    expect(billOfLading.referenceNumber).toBe('BL-1');

    await expect(
      service.createRecord(
        BookingDocumentType.ARRIVAL_NOTICE,
        { anNumber: 'AN-1', bookingId: booking.id },
        4,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.createRecord(
        BookingDocumentType.BILL_OF_LADING,
        { fblNumber: 'BL-2', bookingId: booking.id },
        4,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('import workflow requires AN before DO and rejects duplicate active steps', async () => {
    const booking = await service.createRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      { bookingNumber: 'IMP-2', bookingFlow: BookingFlow.IMPORT },
      4,
    );
    await expect(
      service.createRecord(
        BookingDocumentType.DELIVERY_ORDER,
        { doNumber: 'DO-EARLY', bookingId: booking.id },
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
    userRepository.findOne.mockResolvedValue({
      id: 4,
      fullName: 'Operator',
      email: 'operator@seatrans.test',
    });
    const booking = await service.createRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      {
        bookingNumber: 'IMP-LOCK',
        bookingFlow: BookingFlow.IMPORT,
        to: 'Client',
        vesselVoyage: 'Vessel / V1',
        portOfLoading: 'SGN',
        portOfDischarge: 'QNH',
        commodity: 'Stone',
        cargoVolumes: { "20'DC": 1 },
      },
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
      booking.version,
    );

    await expect(
      service.updateRecord(
        BookingDocumentType.ARRIVAL_NOTICE,
        arrivalNotice.id,
        { anNumber: 'AN-LOCK-2', expectedVersion: arrivalNotice.version },
        4,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.createRecord(
        BookingDocumentType.DELIVERY_ORDER,
        { doNumber: 'DO-LOCK', bookingId: booking.id },
        4,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('translates a concurrent unique constraint failure into conflict', async () => {
    const booking = await service.createRecord(
      BookingDocumentType.BOOKING_CONFIRMATION,
      { bookingNumber: 'IMP-RACE', bookingFlow: BookingFlow.IMPORT },
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
