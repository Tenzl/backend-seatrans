import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BookingDocumentHistoryService } from './booking-document-history.service';
import { BookingDocumentPayloadValidator } from './booking-document-payload.validator';
import { BookingDocumentPreview } from './booking-document.types';
import { UpsertBookingDocumentRecordDto } from './dto/upsert-booking-document-record.dto';
import { BookingDocumentStatus } from './enums/booking-document-status.enum';
import { BookingDocumentType } from './enums/booking-document-type.enum';
import { BookingDocumentPdfRenderer } from './rendering/booking-document-pdf.renderer';

@Injectable()
export class BookingDocumentsService {
  constructor(
    private readonly payloadValidator: BookingDocumentPayloadValidator,
    private readonly historyService: BookingDocumentHistoryService,
    private readonly pdfRenderer: BookingDocumentPdfRenderer,
  ) {}

  async createRecord(
    type: BookingDocumentType,
    body: unknown,
    createdByUserId: number,
  ) {
    const { status, payload } = await this.parseUpsertBody(body);
    const validatedPayload = await this.payloadValidator.validate(
      type,
      payload,
    );
    return this.historyService.create(
      type,
      validatedPayload,
      createdByUserId,
      status ?? BookingDocumentStatus.PROCESSING,
    );
  }

  async getRecord(id: number) {
    return this.historyService.getById(id);
  }

  async updateRecord(id: number, body: unknown, actorUserId: number) {
    const existing = await this.historyService.getById(id);
    const { status, payload } = await this.parseUpsertBody(body);
    const validatedPayload = await this.payloadValidator.validate(
      existing.documentType,
      payload,
    );
    return this.historyService.update(
      id,
      existing.documentType,
      validatedPayload,
      actorUserId,
      status,
    );
  }

  async lockRecord(id: number, actorUserId: number) {
    return this.historyService.lock(id, actorUserId);
  }

  async archiveRecord(id: number, actorUserId: number) {
    return this.historyService.archive(id, actorUserId);
  }

  async permanentDeleteRecord(id: number) {
    return this.historyService.hardDelete(id);
  }

  listRecords(type?: BookingDocumentType, page = 0, size = 10) {
    return this.historyService.list(type, page, size);
  }

  async createPreview(
    type: BookingDocumentType,
    payload: unknown,
  ): Promise<BookingDocumentPreview> {
    const validatedPayload = await this.payloadValidator.validate(
      type,
      payload,
    );
    return this.pdfRenderer.render(type, validatedPayload);
  }

  private async parseUpsertBody(body: unknown): Promise<{
    status?: BookingDocumentStatus;
    payload: unknown;
  }> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('Request body must be an object');
    }

    const { status: rawStatus, ...payload } = body as Record<string, unknown>;
    if (rawStatus === undefined) {
      return { payload };
    }

    const envelope = plainToInstance(UpsertBookingDocumentRecordDto, {
      status: rawStatus,
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
            field: 'status',
            message: 'status must be PROCESSING or COMPLETED',
          },
        ],
      });
    }

    return { status: envelope.status, payload };
  }
}
