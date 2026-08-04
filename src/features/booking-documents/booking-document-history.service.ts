import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { BookingDocumentPayload } from './booking-document.types';
import { ArrivalNoticePreviewDto } from './dto/arrival-notice-preview.dto';
import { BillOfLadingPreviewDto } from './dto/bill-of-lading-preview.dto';
import { BookingConfirmationPreviewDto } from './dto/booking-confirmation-preview.dto';
import { DeliveryOrderPreviewDto } from './dto/delivery-order-preview.dto';
import { BookingDocumentRecord } from './entities/booking-document-record.entity';
import { BookingDocumentStatus } from './enums/booking-document-status.enum';
import { BookingDocumentType } from './enums/booking-document-type.enum';
import { BookingFlow } from './enums/booking-flow.enum';

const WORKFLOW_TYPES: Record<BookingFlow, BookingDocumentType[]> = {
  [BookingFlow.EXPORT]: [
    BookingDocumentType.BOOKING_CONFIRMATION,
    BookingDocumentType.ARRIVAL_NOTICE,
    BookingDocumentType.BILL_OF_LADING,
  ],
  [BookingFlow.IMPORT]: [
    BookingDocumentType.BOOKING_CONFIRMATION,
    BookingDocumentType.ARRIVAL_NOTICE,
    BookingDocumentType.DELIVERY_ORDER,
  ],
};

@Injectable()
export class BookingDocumentHistoryService {
  constructor(
    @InjectRepository(BookingDocumentRecord)
    private readonly recordRepository: Repository<BookingDocumentRecord>,
  ) {}

  async create(
    type: BookingDocumentType,
    payload: BookingDocumentPayload,
    createdByUserId: number,
    status: BookingDocumentStatus = BookingDocumentStatus.PROCESSING,
    workflow: { bookingFlow?: BookingFlow; bookingId?: number } = {},
  ) {
    const workflowFields = await this.resolveWorkflowFields(type, workflow);
    const snapshot = this.clonePayload(type, payload);
    const record = this.recordRepository.create({
      documentType: type,
      referenceNumber: this.referenceNumber(type, payload),
      payload: snapshot,
      status,
      createdByUserId,
      updatedByUserId: createdByUserId,
      ...workflowFields,
    });
    try {
      return this.toResponse(await this.recordRepository.save(record));
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

  async getById(id: number) {
    const record = await this.findActiveOrFail(id, true);
    return this.toResponse(record);
  }

  async getWorkflow(bookingId: number) {
    const booking = await this.findActiveOrFail(bookingId, true);
    if (booking.documentType !== BookingDocumentType.BOOKING_CONFIRMATION) {
      throw new NotFoundException('Booking workflow not found');
    }

    const children = await this.recordRepository.find({
      where: { bookingId, deletedAt: IsNull() },
      relations: { createdBy: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const documents = [booking, ...children].reduce<
      Partial<Record<BookingDocumentType, ReturnType<typeof this.toResponse>>>
    >((result, record) => {
      result[record.documentType] = this.toResponse(record);
      return result;
    }, {});

    return {
      id: Number(booking.id),
      flow: booking.bookingFlow ?? BookingFlow.EXPORT,
      documents,
    };
  }

  async update(
    id: number,
    type: BookingDocumentType,
    payload: BookingDocumentPayload,
    actorUserId: number,
    status?: BookingDocumentStatus,
  ) {
    const record = await this.findActiveOrFail(id);
    await this.assertMutable(record);

    if (record.documentType !== type) {
      throw new ConflictException(
        'Document type cannot be changed for an existing record',
      );
    }

    record.payload = this.clonePayload(type, payload);
    record.referenceNumber = this.referenceNumber(type, payload);
    record.updatedByUserId = actorUserId;
    if (status) {
      record.status = status;
    }

    return this.toResponse(await this.recordRepository.save(record));
  }

  async complete(id: number, actorUserId: number) {
    const record = await this.findActiveOrFail(id);
    await this.assertMutable(record);
    record.status = BookingDocumentStatus.COMPLETED;
    record.updatedByUserId = actorUserId;
    return this.toResponse(await this.recordRepository.save(record));
  }

  async lock(id: number, actorUserId: number) {
    const record = await this.findActiveOrFail(id);
    if (record.lockedAt) {
      throw new ConflictException('Document record is already locked');
    }
    record.lockedAt = new Date();
    record.updatedByUserId = actorUserId;
    return this.toResponse(await this.recordRepository.save(record));
  }

  /** Clears lock so the form can be edited again. Caller must enforce ROLE_ADMIN. */
  async unlock(id: number, actorUserId: number) {
    const record = await this.findActiveOrFail(id);
    if (!record.lockedAt) {
      throw new ConflictException('Document record is not locked');
    }
    record.lockedAt = null;
    record.updatedByUserId = actorUserId;
    return this.toResponse(await this.recordRepository.save(record));
  }

  async archive(id: number, actorUserId: number) {
    const record = await this.findActiveOrFail(id);
    record.deletedAt = new Date();
    record.deletedByUserId = actorUserId;
    record.updatedByUserId = actorUserId;
    return this.toResponse(await this.recordRepository.save(record));
  }

  async hardDelete(id: number): Promise<void> {
    const record = await this.recordRepository.findOne({ where: { id } });
    if (!record) {
      throw new NotFoundException('Document record not found');
    }
    await this.recordRepository.remove(record);
  }

  async list(type?: BookingDocumentType, page = 0, size = 10) {
    const safePage = Math.max(0, page);
    const safeSize = Math.min(50, Math.max(1, size));
    const [records, totalElements] = await this.recordRepository.findAndCount({
      where: type
        ? { documentType: type, deletedAt: IsNull() }
        : { deletedAt: IsNull() },
      relations: { createdBy: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: safePage * safeSize,
      take: safeSize,
    });

    return {
      content: records.map((record) => this.toResponse(record)),
      totalElements,
      totalPages: totalElements === 0 ? 0 : Math.ceil(totalElements / safeSize),
      size: safeSize,
      number: safePage,
    };
  }

  private async findActiveOrFail(id: number, withCreator = false) {
    const record = await this.recordRepository.findOne({
      where: { id, deletedAt: IsNull() },
      relations: withCreator ? { createdBy: true } : undefined,
    });
    if (!record) {
      throw new NotFoundException('Document record not found');
    }
    return record;
  }

  private async assertMutable(record: BookingDocumentRecord) {
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
    if (record.bookingId) {
      const booking = await this.findActiveOrFail(record.bookingId);
      if (booking.lockedAt) {
        throw new ConflictException(
          'Booking workflow is locked and cannot be edited',
        );
      }
    }
  }

  private async resolveWorkflowFields(
    type: BookingDocumentType,
    workflow: { bookingFlow?: BookingFlow; bookingId?: number },
  ): Promise<{ bookingFlow: BookingFlow | null; bookingId: number | null }> {
    if (type === BookingDocumentType.BOOKING_CONFIRMATION) {
      if (workflow.bookingId) {
        throw new ConflictException(
          'A Booking cannot belong to another Booking',
        );
      }
      return {
        bookingFlow: workflow.bookingFlow ?? BookingFlow.EXPORT,
        bookingId: null,
      };
    }

    if (!workflow.bookingId) {
      return { bookingFlow: null, bookingId: null };
    }

    const booking = await this.findActiveOrFail(workflow.bookingId);
    if (booking.documentType !== BookingDocumentType.BOOKING_CONFIRMATION) {
      throw new ConflictException('bookingId must reference a Booking record');
    }
    await this.assertMutable(booking);
    const flow = booking.bookingFlow ?? BookingFlow.EXPORT;
    if (!WORKFLOW_TYPES[flow].includes(type)) {
      throw new ConflictException(
        `${type.toUpperCase()} is not part of the ${flow.toLowerCase()} workflow`,
      );
    }
    const existing = await this.recordRepository.findOne({
      where: {
        bookingId: workflow.bookingId,
        documentType: type,
        deletedAt: IsNull(),
      },
    });
    if (existing) {
      throw new ConflictException(
        'This booking already has an active document of that type',
      );
    }
    if (
      type === BookingDocumentType.BILL_OF_LADING ||
      type === BookingDocumentType.DELIVERY_ORDER
    ) {
      const arrivalNotice = await this.recordRepository.findOne({
        where: {
          bookingId: workflow.bookingId,
          documentType: BookingDocumentType.ARRIVAL_NOTICE,
          deletedAt: IsNull(),
        },
      });
      if (!arrivalNotice) {
        throw new ConflictException(
          'Create the Arrival Notice before the final document',
        );
      }
    }
    return { bookingFlow: null, bookingId: workflow.bookingId };
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

  private toResponse(record: BookingDocumentRecord) {
    return {
      id: Number(record.id),
      documentType: record.documentType,
      bookingFlow: record.bookingFlow ?? null,
      bookingId: record.bookingId == null ? null : Number(record.bookingId),
      referenceNumber: record.referenceNumber,
      payload: record.payload,
      status: record.status,
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
