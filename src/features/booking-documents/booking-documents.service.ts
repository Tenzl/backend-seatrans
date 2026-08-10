import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { syncDeliveryOrderCargoFromArrivalNotice } from './an-container';
import { resolveBookingPic } from './booking-pic';
import { BookingDocumentRecordService } from './booking-document-record.service';
import { BookingDocumentPayloadValidator } from './booking-document-payload.validator';
import { BookingDocumentPreview } from './booking-document.types';
import { User } from '../auth/entities/user.entity';
import { ArrivalNoticePreviewDto } from './dto/arrival-notice-preview.dto';
import { BookingConfirmationPreviewDto } from './dto/booking-confirmation-preview.dto';
import { DeliveryOrderPreviewDto } from './dto/delivery-order-preview.dto';
import { UpsertBookingDocumentRecordDto } from './dto/upsert-booking-document-record.dto';
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
    private readonly dataSource: DataSource,
  ) {}

  async createRecord(
    type: BookingDocumentType,
    body: unknown,
    createdByUserId: number,
  ) {
    const { bookingFlow, bookingId, payload } =
      await this.parseUpsertBody(body);
    let validatedPayload = await this.payloadValidator.validate(type, payload);
    if (type === BookingDocumentType.DELIVERY_ORDER && bookingId != null) {
      validatedPayload = await this.overwriteDoCargoFromAn(
        bookingId,
        validatedPayload,
      );
    }
    if (type === BookingDocumentType.BOOKING_CONFIRMATION) {
      validatedPayload = await this.applyBookingPic(
        validatedPayload,
        createdByUserId,
      );
    }

    // ARCH-01: AN create + sibling DO cargo sync must commit or roll back together.
    return this.dataSource.transaction(async (manager) => {
      const created = await this.recordService.create(
        type,
        validatedPayload,
        createdByUserId,
        { bookingFlow, bookingId },
        manager,
      );
      if (type === BookingDocumentType.ARRIVAL_NOTICE && bookingId != null) {
        const anPayload = validatedPayload as ArrivalNoticePreviewDto;
        await this.patchSiblingDoCargoFromAn(
          bookingId,
          anPayload,
          createdByUserId,
          manager,
        );
      }
      return created;
    });
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
    const { expectedVersion, payload } = await this.parseUpsertBody(body, true);
    let validatedPayload = await this.payloadValidator.validate(type, payload);
    const bookingId = existing.bookingId ?? undefined;
    if (type === BookingDocumentType.DELIVERY_ORDER && bookingId != null) {
      validatedPayload = await this.overwriteDoCargoFromAn(
        bookingId,
        validatedPayload,
      );
    }
    if (type === BookingDocumentType.BOOKING_CONFIRMATION) {
      validatedPayload = await this.applyBookingPic(
        validatedPayload,
        existing.createdByUserId,
        existing.payload,
      );
    }

    // ARCH-01: AN update + sibling DO cargo sync must commit or roll back together.
    return this.dataSource.transaction(async (manager) => {
      const updated = await this.recordService.update(
        type,
        id,
        validatedPayload,
        actorUserId,
        expectedVersion!,
        manager,
      );
      if (type === BookingDocumentType.ARRIVAL_NOTICE && bookingId != null) {
        const anPayload = validatedPayload as ArrivalNoticePreviewDto;
        await this.patchSiblingDoCargoFromAn(
          bookingId,
          anPayload,
          actorUserId,
          manager,
        );
      }
      return updated;
    });
  }

  async lockRecord(
    type: BookingDocumentType,
    id: number,
    actorUserId: number,
    expectedVersion: number,
  ) {
    return this.recordService.lock(type, id, actorUserId, expectedVersion);
  }

  async unlockRecord(
    type: BookingDocumentType,
    id: number,
    actorUserId: number,
    expectedVersion: number,
  ) {
    return this.recordService.unlock(type, id, actorUserId, expectedVersion);
  }

  async archiveRecord(
    type: BookingDocumentType,
    id: number,
    actorUserId: number,
    expectedVersion: number,
  ) {
    return this.recordService.archive(type, id, actorUserId, expectedVersion);
  }

  async restoreRecord(
    type: BookingDocumentType,
    id: number,
    actorUserId: number,
    expectedVersion: number,
  ) {
    return this.recordService.restore(type, id, actorUserId, expectedVersion);
  }

  async permanentDeleteRecord(type: BookingDocumentType, id: number) {
    return this.recordService.hardDelete(type, id);
  }

  listRecords(
    type: BookingDocumentType,
    page = 0,
    size = 10,
    archived: 'active' | 'archived' | 'all' = 'active',
  ) {
    return this.recordService.list(type, page, size, archived);
  }

  async createPreview(
    type: BookingDocumentType,
    payload: unknown,
    actorUserId?: number,
  ): Promise<BookingDocumentPreview> {
    let validatedPayload = await this.payloadValidator.validate(type, payload);
    if (
      type === BookingDocumentType.BOOKING_CONFIRMATION &&
      actorUserId != null
    ) {
      validatedPayload = await this.applyBookingPic(
        validatedPayload,
        actorUserId,
      );
    }
    return this.pdfRenderer.render(type, validatedPayload);
  }

  async createRecordPreview(
    type: BookingDocumentType,
    id: number,
  ): Promise<BookingDocumentPreview> {
    const record = await this.recordService.getById(type, id);
    return this.pdfRenderer.render(type, record.payload);
  }

  private async applyBookingPic(
    payload: BookingConfirmationPreviewDto,
    creatorUserId: number,
    existing?: BookingConfirmationPreviewDto,
  ): Promise<BookingConfirmationPreviewDto> {
    const selectedUserId = payload.picUserId ?? existing?.picUserId;
    const legacyPic = selectedUserId == null ? existing?.pic?.trim() : '';
    if (legacyPic) {
      return this.payloadValidator.validate(
        BookingDocumentType.BOOKING_CONFIRMATION,
        { ...payload, pic: legacyPic },
      );
    }
    const userId = selectedUserId ?? creatorUserId;
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });
    if (selectedUserId != null && !user) {
      throw new BadRequestException(`Unknown picUserId ${selectedUserId}`);
    }
    const pic = resolveBookingPic(
      user,
      selectedUserId == null ? existing?.pic : undefined,
    );
    return await this.payloadValidator.validate(
      BookingDocumentType.BOOKING_CONFIRMATION,
      { ...payload, picUserId: selectedUserId ?? user?.id, pic },
    );
  }

  /** DO cargo/containers mirror BL: owned by AN, read-only on the DO form. */
  private async overwriteDoCargoFromAn(
    bookingId: number,
    doPayload: DeliveryOrderPreviewDto,
    manager?: EntityManager,
  ): Promise<DeliveryOrderPreviewDto> {
    const an = await this.recordService.findActiveByBookingId(
      BookingDocumentType.ARRIVAL_NOTICE,
      bookingId,
      manager,
    );
    if (!an) return doPayload;
    const synced = syncDeliveryOrderCargoFromArrivalNotice(
      an.payload as ArrivalNoticePreviewDto,
      doPayload,
    );
    return await this.payloadValidator.validate(
      BookingDocumentType.DELIVERY_ORDER,
      synced,
    );
  }

  /** When AN cargo changes, keep the sibling DO cargo in lockstep. */
  private async patchSiblingDoCargoFromAn(
    bookingId: number,
    anPayload: ArrivalNoticePreviewDto,
    actorUserId: number,
    manager: EntityManager,
  ): Promise<void> {
    const doc = await this.recordService.findActiveByBookingId(
      BookingDocumentType.DELIVERY_ORDER,
      bookingId,
      manager,
    );
    if (!doc) return;
    const synced = syncDeliveryOrderCargoFromArrivalNotice(
      anPayload,
      doc.payload as DeliveryOrderPreviewDto,
    );
    if (doc.lockedAt) {
      if (
        JSON.stringify(this.doCargoProjection(synced)) !==
        JSON.stringify(this.doCargoProjection(doc.payload))
      ) {
        throw new ConflictException(
          'Arrival Notice cargo cannot change while the linked Delivery Order is locked',
        );
      }
      return;
    }
    const validated = await this.payloadValidator.validate(
      BookingDocumentType.DELIVERY_ORDER,
      synced,
    );
    await this.recordService.update(
      BookingDocumentType.DELIVERY_ORDER,
      doc.id,
      validated,
      actorUserId,
      doc.version,
      manager,
    );
  }

  private doCargoProjection(payload: DeliveryOrderPreviewDto) {
    return {
      serviceMode: payload.serviceMode,
      descriptionOfGoods: payload.descriptionOfGoods,
      containers: payload.containers,
    };
  }

  private async parseUpsertBody(
    body: unknown,
    requireVersion = false,
  ): Promise<{
    expectedVersion?: number;
    bookingFlow?: BookingFlow;
    bookingId?: number;
    payload: unknown;
  }> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('Request body must be an object');
    }

    const {
      expectedVersion: rawExpectedVersion,
      bookingFlow: rawBookingFlow,
      bookingId: rawBookingId,
      ...payload
    } = body as Record<string, unknown>;

    const envelope = plainToInstance(UpsertBookingDocumentRecordDto, {
      expectedVersion: rawExpectedVersion,
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
    if (requireVersion && envelope.expectedVersion == null) {
      throw new BadRequestException('expectedVersion is required');
    }

    return {
      expectedVersion: envelope.expectedVersion,
      bookingFlow: envelope.bookingFlow,
      bookingId: envelope.bookingId,
      payload,
    };
  }
}
