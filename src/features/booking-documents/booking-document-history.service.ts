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
  ) {
    const snapshot = this.clonePayload(payload);
    const record = this.recordRepository.create({
      documentType: type,
      referenceNumber: this.referenceNumber(type, payload),
      payload: snapshot,
      status,
      createdByUserId,
      updatedByUserId: createdByUserId,
    });
    return this.toResponse(await this.recordRepository.save(record));
  }

  async getById(id: number) {
    const record = await this.findActiveOrFail(id, true);
    return this.toResponse(record);
  }

  async update(
    id: number,
    type: BookingDocumentType,
    payload: BookingDocumentPayload,
    actorUserId: number,
    status?: BookingDocumentStatus,
  ) {
    const record = await this.findActiveOrFail(id);
    this.assertMutable(record);

    if (record.documentType !== type) {
      throw new ConflictException(
        'Document type cannot be changed for an existing record',
      );
    }

    record.payload = this.clonePayload(payload);
    record.referenceNumber = this.referenceNumber(type, payload);
    record.updatedByUserId = actorUserId;
    if (status) {
      record.status = status;
    }

    return this.toResponse(await this.recordRepository.save(record));
  }

  async complete(id: number, actorUserId: number) {
    const record = await this.findActiveOrFail(id);
    this.assertMutable(record);
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

  private assertMutable(record: BookingDocumentRecord) {
    if (record.lockedAt) {
      throw new ConflictException('Document record is locked and cannot be edited');
    }
    if (record.deletedAt) {
      throw new ConflictException('Document record is archived and cannot be edited');
    }
  }

  private clonePayload(payload: BookingDocumentPayload): Record<string, unknown> {
    return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
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
      referenceNumber: record.referenceNumber,
      payload: record.payload,
      status: record.status,
      createdByUserId: record.createdByUserId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt?.toISOString() ?? record.createdAt.toISOString(),
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
