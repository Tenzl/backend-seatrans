import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Repository } from 'typeorm';
import {
  syncBillOfLadingCargoFromArrivalNotice,
  syncDeliveryOrderCargoFromArrivalNotice,
} from './an-container';
import { resolveBookingPic } from './booking-pic';
import { BookingDocumentRecordService } from './booking-document-record.service';
import { BookingDocumentPayloadValidator } from './booking-document-payload.validator';
import {
  BookingDocumentPayload,
  BookingDocumentPreview,
} from './booking-document.types';
import { User } from '../auth/entities/user.entity';
import { ArrivalNoticePreviewDto } from './dto/arrival-notice-preview.dto';
import { BillOfLadingPreviewDto } from './dto/bill-of-lading-preview.dto';
import { BookingConfirmationPreviewDto } from './dto/booking-confirmation-preview.dto';
import { DeliveryOrderPreviewDto } from './dto/delivery-order-preview.dto';
import { UpsertBookingDocumentRecordDto } from './dto/upsert-booking-document-record.dto';
import { BookingDocumentStatus } from './enums/booking-document-status.enum';
import { BookingDocumentType } from './enums/booking-document-type.enum';
import { BookingFlow } from './enums/booking-flow.enum';
import { BookingDocumentPdfRenderer } from './rendering/booking-document-pdf.renderer';

@Injectable()
export class BookingDocumentsService {
  constructor(
    private readonly payloadValidator: BookingDocumentPayloadValidator,
    private readonly recordService: BookingDocumentRecordService,
    private readonly pdfRenderer: BookingDocumentPdfRenderer,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async createRecord(
    type: BookingDocumentType,
    body: unknown,
    createdByUserId: number,
  ) {
    const { status, bookingFlow, bookingId, payload } =
      await this.parseUpsertBody(body);
    let validatedPayload = await this.payloadValidator.validate(
      type,
      payload,
    );
    if (
      type === BookingDocumentType.BILL_OF_LADING &&
      bookingId != null
    ) {
      validatedPayload = await this.overwriteBlCargoFromAn(
        bookingId,
        validatedPayload as BillOfLadingPreviewDto,
      );
    }
    if (
      type === BookingDocumentType.DELIVERY_ORDER &&
      bookingId != null
    ) {
      validatedPayload = await this.overwriteDoCargoFromAn(
        bookingId,
        validatedPayload as DeliveryOrderPreviewDto,
      );
    }
    if (type === BookingDocumentType.BOOKING_CONFIRMATION) {
      validatedPayload = await this.applyBookingPic(
        validatedPayload as BookingConfirmationPreviewDto,
        createdByUserId,
        (validatedPayload as BookingConfirmationPreviewDto).pic,
      );
    }
    const created = await this.recordService.create(
      type,
      validatedPayload,
      createdByUserId,
      status ?? BookingDocumentStatus.PROCESSING,
      { bookingFlow, bookingId },
    );
    if (
      type === BookingDocumentType.ARRIVAL_NOTICE &&
      bookingId != null
    ) {
      const anPayload = validatedPayload as ArrivalNoticePreviewDto;
      await this.patchSiblingBlCargoFromAn(
        bookingId,
        anPayload,
        createdByUserId,
      );
      await this.patchSiblingDoCargoFromAn(
        bookingId,
        anPayload,
        createdByUserId,
      );
    }
    return created;
  }

  async getRecord(type: BookingDocumentType, id: number) {
    return this.recordService.getById(type, id);
  }

  async getWorkflow(bookingId: number) {
    return this.recordService.getWorkflow(bookingId);
  }

  async updateRecord(
    type: BookingDocumentType,
    id: number,
    body: unknown,
    actorUserId: number,
  ) {
    const existing = await this.recordService.getById(type, id);
    const { status, payload } = await this.parseUpsertBody(body);
    let validatedPayload = await this.payloadValidator.validate(
      type,
      payload,
    );
    const bookingId = existing.bookingId ?? undefined;
    if (
      type === BookingDocumentType.BILL_OF_LADING &&
      bookingId != null
    ) {
      validatedPayload = await this.overwriteBlCargoFromAn(
        bookingId,
        validatedPayload as BillOfLadingPreviewDto,
      );
    }
    if (
      type === BookingDocumentType.DELIVERY_ORDER &&
      bookingId != null
    ) {
      validatedPayload = await this.overwriteDoCargoFromAn(
        bookingId,
        validatedPayload as DeliveryOrderPreviewDto,
      );
    }
    if (type === BookingDocumentType.BOOKING_CONFIRMATION) {
      validatedPayload = await this.applyBookingPic(
        validatedPayload as BookingConfirmationPreviewDto,
        existing.createdByUserId,
        (validatedPayload as BookingConfirmationPreviewDto).pic,
      );
    }
    const updated = await this.recordService.update(
      type,
      id,
      validatedPayload,
      actorUserId,
      status,
    );
    if (
      type === BookingDocumentType.ARRIVAL_NOTICE &&
      bookingId != null
    ) {
      const anPayload = validatedPayload as ArrivalNoticePreviewDto;
      await this.patchSiblingBlCargoFromAn(
        bookingId,
        anPayload,
        actorUserId,
      );
      await this.patchSiblingDoCargoFromAn(
        bookingId,
        anPayload,
        actorUserId,
      );
    }
    return updated;
  }

  async lockRecord(type: BookingDocumentType, id: number, actorUserId: number) {
    return this.recordService.lock(type, id, actorUserId);
  }

  async unlockRecord(
    type: BookingDocumentType,
    id: number,
    actorUserId: number,
  ) {
    return this.recordService.unlock(type, id, actorUserId);
  }

  async archiveRecord(
    type: BookingDocumentType,
    id: number,
    actorUserId: number,
  ) {
    return this.recordService.archive(type, id, actorUserId);
  }

  async permanentDeleteRecord(type: BookingDocumentType, id: number) {
    return this.recordService.hardDelete(type, id);
  }

  listRecords(type: BookingDocumentType, page = 0, size = 10) {
    return this.recordService.list(type, page, size);
  }

  async createPreview(
    type: BookingDocumentType,
    payload: unknown,
    actorUserId?: number,
  ): Promise<BookingDocumentPreview> {
    let validatedPayload = await this.payloadValidator.validate(
      type,
      payload,
    );
    if (
      type === BookingDocumentType.BOOKING_CONFIRMATION &&
      actorUserId != null
    ) {
      validatedPayload = await this.applyBookingPic(
        validatedPayload as BookingConfirmationPreviewDto,
        actorUserId,
        (validatedPayload as BookingConfirmationPreviewDto).pic,
      );
    }
    return this.pdfRenderer.render(type, validatedPayload);
  }

  private async applyBookingPic(
    payload: BookingConfirmationPreviewDto,
    creatorUserId: number,
    existingPic?: string | null,
  ): Promise<BookingConfirmationPreviewDto> {
    const creator = await this.userRepository.findOne({
      where: { id: creatorUserId },
    });
    const pic = resolveBookingPic(creator, existingPic);
    return (await this.payloadValidator.validate(
      BookingDocumentType.BOOKING_CONFIRMATION,
      { ...payload, pic },
    )) as BookingConfirmationPreviewDto;
  }

  /**
   * BL save must not persist client-divergent cargo — always copy from AN.
   */
  private async overwriteBlCargoFromAn(
    bookingId: number,
    blPayload: BillOfLadingPreviewDto,
  ): Promise<BillOfLadingPreviewDto> {
    const an = await this.recordService.findActiveByBookingId(
      BookingDocumentType.ARRIVAL_NOTICE,
      bookingId,
    );
    if (!an) return blPayload;
    const synced = syncBillOfLadingCargoFromArrivalNotice(
      an.payload as ArrivalNoticePreviewDto,
      blPayload,
    );
    return (await this.payloadValidator.validate(
      BookingDocumentType.BILL_OF_LADING,
      synced,
    )) as BillOfLadingPreviewDto;
  }

  /** When AN cargo changes, keep the sibling BL cargo in lockstep. */
  private async patchSiblingBlCargoFromAn(
    bookingId: number,
    anPayload: ArrivalNoticePreviewDto,
    actorUserId: number,
  ): Promise<void> {
    const bl = await this.recordService.findActiveByBookingId(
      BookingDocumentType.BILL_OF_LADING,
      bookingId,
    );
    if (!bl || bl.lockedAt) return;
    const synced = syncBillOfLadingCargoFromArrivalNotice(
      anPayload,
      bl.payload as BillOfLadingPreviewDto,
    );
    const validated = (await this.payloadValidator.validate(
      BookingDocumentType.BILL_OF_LADING,
      synced,
    )) as BookingDocumentPayload;
    await this.recordService.update(
      BookingDocumentType.BILL_OF_LADING,
      bl.id,
      validated,
      actorUserId,
    );
  }

  /** DO cargo/containers mirror BL: owned by AN, read-only on the DO form. */
  private async overwriteDoCargoFromAn(
    bookingId: number,
    doPayload: DeliveryOrderPreviewDto,
  ): Promise<DeliveryOrderPreviewDto> {
    const an = await this.recordService.findActiveByBookingId(
      BookingDocumentType.ARRIVAL_NOTICE,
      bookingId,
    );
    if (!an) return doPayload;
    const synced = syncDeliveryOrderCargoFromArrivalNotice(
      an.payload as ArrivalNoticePreviewDto,
      doPayload,
    );
    return (await this.payloadValidator.validate(
      BookingDocumentType.DELIVERY_ORDER,
      synced,
    )) as DeliveryOrderPreviewDto;
  }

  /** When AN cargo changes, keep the sibling DO cargo in lockstep. */
  private async patchSiblingDoCargoFromAn(
    bookingId: number,
    anPayload: ArrivalNoticePreviewDto,
    actorUserId: number,
  ): Promise<void> {
    const doc = await this.recordService.findActiveByBookingId(
      BookingDocumentType.DELIVERY_ORDER,
      bookingId,
    );
    if (!doc || doc.lockedAt) return;
    const synced = syncDeliveryOrderCargoFromArrivalNotice(
      anPayload,
      doc.payload as DeliveryOrderPreviewDto,
    );
    const validated = (await this.payloadValidator.validate(
      BookingDocumentType.DELIVERY_ORDER,
      synced,
    )) as BookingDocumentPayload;
    await this.recordService.update(
      BookingDocumentType.DELIVERY_ORDER,
      doc.id,
      validated,
      actorUserId,
    );
  }

  private async parseUpsertBody(body: unknown): Promise<{
    status?: BookingDocumentStatus;
    bookingFlow?: BookingFlow;
    bookingId?: number;
    payload: unknown;
  }> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('Request body must be an object');
    }

    const {
      status: rawStatus,
      bookingFlow: rawBookingFlow,
      bookingId: rawBookingId,
      ...payload
    } = body as Record<string, unknown>;

    const envelope = plainToInstance(UpsertBookingDocumentRecordDto, {
      status: rawStatus,
      bookingFlow: rawBookingFlow,
      bookingId: rawBookingId,
    });
    const errors = await validate(envelope, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Request validation failed',
        details: [
          {
            field: errors[0]?.property ?? 'metadata',
            message:
              Object.values(errors[0]?.constraints ?? {})[0] ??
              'Invalid booking workflow metadata',
          },
        ],
      });
    }

    return {
      status: envelope.status,
      bookingFlow: envelope.bookingFlow,
      bookingId: envelope.bookingId,
      payload,
    };
  }
}
