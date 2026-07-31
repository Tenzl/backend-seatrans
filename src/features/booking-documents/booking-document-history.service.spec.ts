import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BookingDocumentHistoryService } from './booking-document-history.service';
import { BookingDocumentPayloadValidator } from './booking-document-payload.validator';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingDocumentStatus } from './enums/booking-document-status.enum';
import { BookingDocumentType } from './enums/booking-document-type.enum';
import { BookingDocumentPdfRenderer } from './rendering/booking-document-pdf.renderer';

describe('BookingDocumentHistoryService lifecycle', () => {
  const records = new Map<number, Record<string, unknown>>();
  let nextId = 1;

  const recordRepository = {
    create: jest.fn((value: object) => ({ ...value })),
    save: jest.fn(async (record: Record<string, unknown>) => {
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
      return saved;
    }),
    findOne: jest.fn(
      async (options: {
        where: { id: number; deletedAt?: unknown };
        relations?: unknown;
      }) => {
        const row = records.get(options.where.id);
        if (!row) return null;
        if (
          options.where.deletedAt !== undefined &&
          row.deletedAt != null
        ) {
          return null;
        }
        return row;
      },
    ),
    findAndCount: jest.fn(async (options: { where: { deletedAt?: unknown } }) => {
      const all = [...records.values()].filter((row) => row.deletedAt == null);
      return [all, all.length];
    }),
    remove: jest.fn(async (record: { id: number }) => {
      records.delete(Number(record.id));
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
});
