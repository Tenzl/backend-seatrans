import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, IsNull, Repository } from 'typeorm';
import { saveWithOptimisticLock } from '../../shared/utils/optimistic-lock';
import { BookingDocumentPayload } from './booking-document.types';
import { ArrivalNoticePreviewDto } from './dto/arrival-notice-preview.dto';
import { BillOfLadingPreviewDto } from './dto/bill-of-lading-preview.dto';
import { BookingConfirmationPreviewDto } from './dto/booking-confirmation-preview.dto';
import { DeliveryOrderPreviewDto } from './dto/delivery-order-preview.dto';
import { ArrivalNoticeRecord } from './entities/arrival-notice-record.entity';
import { BillOfLadingRecord } from './entities/bill-of-lading-record.entity';
import { BookingDocumentRecordBase } from './entities/booking-document-record-base.entity';
import { BookingRecord } from './entities/booking-record.entity';
import { DeliveryOrderRecord } from './entities/delivery-order-record.entity';
import { BookingDocumentStatus } from './enums/booking-document-status.enum';
import { BookingDocumentType } from './enums/booking-document-type.enum';
import { BookingFlow } from './enums/booking-flow.enum';

const WORKFLOW_TYPES: Record<BookingFlow, BookingDocumentType[]> = {
  [BookingFlow.EXPORT]: [
    BookingDocumentType.BOOKING_CONFIRMATION,
    BookingDocumentType.BILL_OF_LADING,
  ],
  [BookingFlow.IMPORT]: [
    BookingDocumentType.BOOKING_CONFIRMATION,
    BookingDocumentType.ARRIVAL_NOTICE,
    BookingDocumentType.DELIVERY_ORDER,
  ],
};

type ChildRecord =
  | ArrivalNoticeRecord
  | DeliveryOrderRecord
  | BillOfLadingRecord;
type DocumentRecord = BookingRecord | ChildRecord;
type WorkflowFields = {
  bookingFlow?: BookingFlow;
  bookingId?: number;
};

@Injectable()
export class BookingDocumentRecordService {
  constructor(
    @InjectRepository(BookingRecord)
    private readonly bookingRepository: Repository<BookingRecord>,
    @InjectRepository(ArrivalNoticeRecord)
    private readonly arrivalNoticeRepository: Repository<ArrivalNoticeRecord>,
    @InjectRepository(DeliveryOrderRecord)
    private readonly deliveryOrderRepository: Repository<DeliveryOrderRecord>,
    @InjectRepository(BillOfLadingRecord)
    private readonly billOfLadingRepository: Repository<BillOfLadingRecord>,
  ) {}

  async create(
    type: BookingDocumentType,
    payload: BookingDocumentPayload,
    createdByUserId: number,
    status: BookingDocumentStatus = BookingDocumentStatus.PROCESSING,
    workflow: WorkflowFields = {},
    manager?: EntityManager,
  ) {
    const workflowFields = await this.resolveWorkflowFields(
      type,
      workflow,
      manager,
    );
    const snapshot = this.clonePayload(type, payload);
    const repository = this.repository(type, manager);
    const record = repository.create({
      payload: snapshot,
      status,
      createdByUserId,
      updatedByUserId: createdByUserId,
      ...workflowFields,
    } as DeepPartial<BookingDocumentRecordBase>);

    try {
      return this.toResponse(
        type,
        await saveWithOptimisticLock(
          () => repository.save(record),
          'Document record was modified concurrently; reload and retry',
        ),
      );
    } catch (error) {
      const databaseCode = (error as { driverError?: { code?: string } } | null)
        ?.driverError?.code;
      if (workflow.bookingId && databaseCode === '23505') {
        throw new ConflictException(
          'This booking already has an active document of that type',
        );
      }
      throw error;
    }
  }

  async getById(
    type: BookingDocumentType,
    id: number,
    manager?: EntityManager,
  ) {
    const record = await this.findActiveOrFail(type, id, true, manager);
    return this.toResponse(type, record);
  }

  /** Active child document for a booking, or null when none exists. */
  async findActiveByBookingId(
    type: BookingDocumentType,
    bookingId: number,
    manager?: EntityManager,
  ) {
    if (type === BookingDocumentType.BOOKING_CONFIRMATION) {
      return this.getById(type, bookingId, manager);
    }
    const record = await this.repository(type, manager).findOne({
      where: { bookingId, deletedAt: IsNull() } as never,
    });
    return record ? this.toResponse(type, record) : null;
  }

  async getWorkflow(bookingId: number) {
    const booking = (await this.findActiveOrFail(
      BookingDocumentType.BOOKING_CONFIRMATION,
      bookingId,
      true,
    )) as BookingRecord;

    const childTypes = [
      BookingDocumentType.ARRIVAL_NOTICE,
      BookingDocumentType.BILL_OF_LADING,
      BookingDocumentType.DELIVERY_ORDER,
    ] as const;
    const childGroups = await Promise.all(
      childTypes.map(async (type) => ({
        type,
        records: await this.repository(type).find({
          where: { bookingId, deletedAt: IsNull() } as never,
          relations: { createdBy: true },
          order: { createdAt: 'ASC', id: 'ASC' },
        }),
      })),
    );

    const documents: Partial<
      Record<BookingDocumentType, ReturnType<typeof this.toResponse>>
    > = {
      [BookingDocumentType.BOOKING_CONFIRMATION]: this.toResponse(
        BookingDocumentType.BOOKING_CONFIRMATION,
        booking,
      ),
    };
    for (const group of childGroups) {
      for (const record of group.records) {
        documents[group.type] = this.toResponse(group.type, record);
      }
    }

    return {
      id: Number(booking.id),
      flow: booking.bookingFlow,
      documents,
    };
  }

  async update(
    type: BookingDocumentType,
    id: number,
    payload: BookingDocumentPayload,
    actorUserId: number,
    status?: BookingDocumentStatus,
    manager?: EntityManager,
  ) {
    const record = await this.findActiveOrFail(type, id, false, manager);
    await this.assertMutable(type, record, manager);

    record.payload = this.clonePayload(type, payload);
    record.updatedByUserId = actorUserId;
    if (status) record.status = status;

    return this.toResponse(
      type,
      await saveWithOptimisticLock(
        () => this.repository(type, manager).save(record),
        'Document record was modified concurrently; reload and retry',
      ),
    );
  }

  async complete(
    type: BookingDocumentType,
    id: number,
    actorUserId: number,
    manager?: EntityManager,
  ) {
    const record = await this.findActiveOrFail(type, id, false, manager);
    await this.assertMutable(type, record, manager);
    record.status = BookingDocumentStatus.COMPLETED;
    record.updatedByUserId = actorUserId;
    return this.toResponse(
      type,
      await saveWithOptimisticLock(
        () => this.repository(type, manager).save(record),
        'Document record was modified concurrently; reload and retry',
      ),
    );
  }

  async lock(
    type: BookingDocumentType,
    id: number,
    actorUserId: number,
    manager?: EntityManager,
  ) {
    const record = await this.findActiveOrFail(type, id, false, manager);
    if (record.lockedAt) {
      throw new ConflictException('Document record is already locked');
    }
    record.lockedAt = new Date();
    record.updatedByUserId = actorUserId;
    try {
      return this.toResponse(
        type,
        await saveWithOptimisticLock(
          () => this.repository(type, manager).save(record),
          'Document record was modified concurrently; reload and retry',
        ),
      );
    } catch (error) {
      if (error instanceof ConflictException) {
        const fresh = await this.findActiveOrFail(type, id, false, manager);
        if (fresh.lockedAt) {
          throw new ConflictException('Document record is already locked');
        }
      }
      throw error;
    }
  }

  async unlock(
    type: BookingDocumentType,
    id: number,
    actorUserId: number,
    manager?: EntityManager,
  ) {
    const record = await this.findActiveOrFail(type, id, false, manager);
    if (!record.lockedAt) {
      throw new ConflictException('Document record is not locked');
    }
    record.lockedAt = null;
    record.updatedByUserId = actorUserId;
    return this.toResponse(
      type,
      await saveWithOptimisticLock(
        () => this.repository(type, manager).save(record),
        'Document record was modified concurrently; reload and retry',
      ),
    );
  }

  async archive(
    type: BookingDocumentType,
    id: number,
    actorUserId: number,
    manager?: EntityManager,
  ) {
    const record = await this.findActiveOrFail(type, id, false, manager);
    record.deletedAt = new Date();
    record.deletedByUserId = actorUserId;
    record.updatedByUserId = actorUserId;
    return this.toResponse(
      type,
      await saveWithOptimisticLock(
        () => this.repository(type, manager).save(record),
        'Document record was modified concurrently; reload and retry',
      ),
    );
  }

  async hardDelete(
    type: BookingDocumentType,
    id: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repository = this.repository(type, manager);
    const record = await repository.findOne({ where: { id } });
    if (!record) throw new NotFoundException('Document record not found');
    await repository.remove(record);
  }

  async list(type: BookingDocumentType, page = 0, size = 10) {
    const safePage = Math.max(0, page);
    const safeSize = Math.min(50, Math.max(1, size));
    const [records, totalElements] = await this.repository(type).findAndCount({
      where: { deletedAt: IsNull() } as never,
      relations: { createdBy: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: safePage * safeSize,
      take: safeSize,
    });

    return {
      content: records.map((record) => this.toResponse(type, record)),
      totalElements,
      totalPages: totalElements === 0 ? 0 : Math.ceil(totalElements / safeSize),
      size: safeSize,
      number: safePage,
    };
  }

  private repository(
    type: BookingDocumentType,
    manager?: EntityManager,
  ): Repository<BookingDocumentRecordBase> {
    if (manager) {
      switch (type) {
        case BookingDocumentType.BOOKING_CONFIRMATION:
          return manager.getRepository(BookingRecord);
        case BookingDocumentType.ARRIVAL_NOTICE:
          return manager.getRepository(ArrivalNoticeRecord);
        case BookingDocumentType.DELIVERY_ORDER:
          return manager.getRepository(DeliveryOrderRecord);
        case BookingDocumentType.BILL_OF_LADING:
          return manager.getRepository(BillOfLadingRecord);
      }
    }
    switch (type) {
      case BookingDocumentType.BOOKING_CONFIRMATION:
        return this.bookingRepository;
      case BookingDocumentType.ARRIVAL_NOTICE:
        return this.arrivalNoticeRepository;
      case BookingDocumentType.DELIVERY_ORDER:
        return this.deliveryOrderRepository;
      case BookingDocumentType.BILL_OF_LADING:
        return this.billOfLadingRepository;
    }
  }

  private async findActiveOrFail(
    type: BookingDocumentType,
    id: number,
    withCreator = false,
    manager?: EntityManager,
  ): Promise<DocumentRecord> {
    const record = await this.repository(type, manager).findOne({
      where: { id, deletedAt: IsNull() },
      relations: withCreator ? { createdBy: true } : undefined,
    });
    if (!record) throw new NotFoundException('Document record not found');
    return record as DocumentRecord;
  }

  private async assertMutable(
    type: BookingDocumentType,
    record: DocumentRecord,
    manager?: EntityManager,
  ) {
    if (record.lockedAt) {
      throw new ConflictException(
        'Document record is locked and cannot be edited',
      );
    }
    if (record.deletedAt) {
      throw new ConflictException(
        'Document record is archived and cannot be edited',
      );
    }
    if (type !== BookingDocumentType.BOOKING_CONFIRMATION) {
      const bookingId = (record as ChildRecord).bookingId;
      if (bookingId) {
        const booking = await this.findActiveOrFail(
          BookingDocumentType.BOOKING_CONFIRMATION,
          bookingId,
          false,
          manager,
        );
        if (booking.lockedAt) {
          throw new ConflictException(
            'Booking workflow is locked and cannot be edited',
          );
        }
      }
    }
  }

  private async resolveWorkflowFields(
    type: BookingDocumentType,
    workflow: WorkflowFields,
    manager?: EntityManager,
  ): Promise<{ bookingFlow?: BookingFlow; bookingId?: number | null }> {
    if (type === BookingDocumentType.BOOKING_CONFIRMATION) {
      if (workflow.bookingId) {
        throw new ConflictException(
          'A Booking cannot belong to another Booking',
        );
      }
      return { bookingFlow: workflow.bookingFlow ?? BookingFlow.EXPORT };
    }

    if (!workflow.bookingId) return { bookingId: null };

    const booking = (await this.findActiveOrFail(
      BookingDocumentType.BOOKING_CONFIRMATION,
      workflow.bookingId,
      false,
      manager,
    )) as BookingRecord;
    await this.assertMutable(
      BookingDocumentType.BOOKING_CONFIRMATION,
      booking,
      manager,
    );
    if (!WORKFLOW_TYPES[booking.bookingFlow].includes(type)) {
      throw new ConflictException(
        `${type.toUpperCase()} is not part of the ${booking.bookingFlow.toLowerCase()} workflow`,
      );
    }

    const repository = this.repository(type, manager);
    const existing = await repository.findOne({
      where: { bookingId: workflow.bookingId, deletedAt: IsNull() } as never,
    });
    if (existing) {
      throw new ConflictException(
        'This booking already has an active document of that type',
      );
    }

    if (type === BookingDocumentType.DELIVERY_ORDER) {
      const arrivalNotice = await this.repository(
        BookingDocumentType.ARRIVAL_NOTICE,
        manager,
      ).findOne({
        where: { bookingId: workflow.bookingId, deletedAt: IsNull() } as never,
      });
      if (!arrivalNotice) {
        throw new ConflictException(
          'Create the Arrival Notice before the final document',
        );
      }
    }
    return { bookingId: workflow.bookingId };
  }

  private clonePayload(
    type: BookingDocumentType,
    payload: BookingDocumentPayload,
  ): Record<string, unknown> {
    const snapshot = JSON.parse(JSON.stringify(payload)) as Record<
      string,
      unknown
    >;
    if (type === BookingDocumentType.BILL_OF_LADING) {
      delete snapshot.showSurrendered;
      delete snapshot.includeCompanyStamp;
    }
    return snapshot;
  }

  private referenceNumber(
    type: BookingDocumentType,
    payload: BookingDocumentPayload,
  ): string | null {
    let value: string | undefined;
    switch (type) {
      case BookingDocumentType.ARRIVAL_NOTICE:
        value = (payload as ArrivalNoticePreviewDto).anNumber;
        break;
      case BookingDocumentType.BOOKING_CONFIRMATION:
        value = (payload as BookingConfirmationPreviewDto).bookingNumber;
        break;
      case BookingDocumentType.DELIVERY_ORDER:
        value = (payload as DeliveryOrderPreviewDto).doNumber;
        break;
      case BookingDocumentType.BILL_OF_LADING:
        value = (payload as BillOfLadingPreviewDto).fblNumber;
        break;
    }
    return value?.trim() || null;
  }

  private toResponse(
    type: BookingDocumentType,
    record: BookingDocumentRecordBase,
  ) {
    const bookingFlow =
      type === BookingDocumentType.BOOKING_CONFIRMATION
        ? (record as BookingRecord).bookingFlow
        : null;
    const bookingId =
      type === BookingDocumentType.BOOKING_CONFIRMATION
        ? null
        : ((record as ChildRecord).bookingId ?? null);

    return {
      id: Number(record.id),
      documentType: type,
      bookingFlow,
      bookingId: bookingId == null ? null : Number(bookingId),
      referenceNumber: this.referenceNumber(type, record.payload),
      payload: record.payload,
      status: record.status,
      version: Number(record.version ?? 1),
      createdByUserId: record.createdByUserId,
      createdAt: record.createdAt.toISOString(),
      updatedAt:
        record.updatedAt?.toISOString() ?? record.createdAt.toISOString(),
      updatedByUserId: record.updatedByUserId ?? null,
      lockedAt: record.lockedAt ? record.lockedAt.toISOString() : null,
      deletedAt: record.deletedAt ? record.deletedAt.toISOString() : null,
      deletedByUserId: record.deletedByUserId ?? null,
      createdBy: record.createdBy
        ? {
            id: record.createdBy.id,
            fullName: record.createdBy.fullName ?? null,
            email: record.createdBy.email ?? null,
          }
        : null,
    };
  }
}
