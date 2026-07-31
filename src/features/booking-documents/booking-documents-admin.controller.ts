import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { PermanentDelete } from '../../shared/decorators/permanent-delete.decorator';
import { AdminSection } from '../../shared/decorators/admin-section.decorator';
import { BookingDocumentsService } from './booking-documents.service';
import { BOOKING_DOCUMENT_SECTION } from './constants/booking-document.constants';
import { BookingDocumentType } from './enums/booking-document-type.enum';

type AuthenticatedRequest = Request & {
  user?: { id?: number; email?: string; fullName?: string };
};

@AdminSection(BOOKING_DOCUMENT_SECTION)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('v1/admin/booking-documents')
export class BookingDocumentsAdminController {
  constructor(private readonly bookingDocuments: BookingDocumentsService) {}

  @Get('records')
  history(
    @Query('type') type?: string,
    @Query('page') page = '0',
    @Query('size') size = '10',
  ) {
    const supportedTypes: string[] = Object.values(BookingDocumentType);
    if (type && !supportedTypes.includes(type)) {
      throw new BadRequestException(`Unsupported document type: ${type}`);
    }
    const documentType = type as BookingDocumentType | undefined;
    return this.bookingDocuments.listRecords(
      documentType,
      this.toInteger(page, 0),
      this.toInteger(size, 10),
    );
  }

  @Get('records/:id')
  getRecord(@Param('id', ParseIntPipe) id: number) {
    return this.bookingDocuments.getRecord(id);
  }

  @Post(':type/records')
  @HttpCode(HttpStatus.CREATED)
  createRecord(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.bookingDocuments.createRecord(
      type,
      body,
      this.requireActorUserId(request),
    );
  }

  @Put('records/:id')
  updateRecord(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.bookingDocuments.updateRecord(
      id,
      body,
      this.requireActorUserId(request),
    );
  }

  @Post('records/:id/lock')
  lockRecord(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.bookingDocuments.lockRecord(
      id,
      this.requireActorUserId(request),
    );
  }

  /** Soft-archive for staff (and admin). */
  @Delete('records/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archiveRecord(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.bookingDocuments.archiveRecord(
      id,
      this.requireActorUserId(request),
    );
  }

  @Delete('records/:id/permanent')
  @HttpCode(HttpStatus.NO_CONTENT)
  @PermanentDelete({
    resourceType: 'booking_document_record',
    idSource: { kind: 'param', key: 'id' },
  })
  async permanentDeleteRecord(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.bookingDocuments.permanentDeleteRecord(id);
  }

  @Post(':type/preview')
  @HttpCode(HttpStatus.OK)
  async preview(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    const preview = await this.bookingDocuments.createPreview(type, body);
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${preview.filename}"`,
      'Content-Length': String(preview.data.length),
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
    });
    response.send(preview.data);
  }

  private requireActorUserId(request: AuthenticatedRequest): number {
    const userId = request.user?.id;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }
    return userId;
  }

  private toInteger(value: string, fallback: number): number {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
