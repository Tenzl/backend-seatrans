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
import { ApiAdminOnly } from '../../shared/decorators/api-admin.decorator';
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

  @Get(':type/records')
  listRecords(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Query('page') page = '0',
    @Query('size') size = '10',
    @Query('archived') archived = 'active',
  ) {
    const filter =
      archived === 'archived' || archived === 'all' ? archived : 'active';
    return this.bookingDocuments.listRecords(
      type,
      this.toInteger(page, 0),
      this.toInteger(size, 10),
      filter,
    );
  }

  @Get(':type/records/:id')
  getRecord(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.bookingDocuments.getRecord(type, id);
  }

  @Get(':type/records/:id/preview')
  async previewRecord(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ): Promise<void> {
    this.sendPreview(
      response,
      await this.bookingDocuments.createRecordPreview(type, id),
    );
  }

  @Get('bookings/:id/workflow')
  getWorkflow(@Param('id', ParseIntPipe) id: number) {
    return this.bookingDocuments.getWorkflow(id);
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

  @Put(':type/records/:id')
  updateRecord(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.bookingDocuments.updateRecord(
      type,
      id,
      body,
      this.requireActorUserId(request),
    );
  }

  @Post(':type/records/:id/lock')
  lockRecord(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Param('id', ParseIntPipe) id: number,
    @Body('expectedVersion', ParseIntPipe) expectedVersion: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.bookingDocuments.lockRecord(
      type,
      id,
      this.requireActorUserId(request),
      expectedVersion,
    );
  }

  /** Admin-only: clear lock so staff can edit the form again. */
  @Post(':type/records/:id/unlock')
  @ApiAdminOnly()
  unlockRecord(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Param('id', ParseIntPipe) id: number,
    @Body('expectedVersion', ParseIntPipe) expectedVersion: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.bookingDocuments.unlockRecord(
      type,
      id,
      this.requireActorUserId(request),
      expectedVersion,
    );
  }

  /** Soft-archive for staff (and admin). */
  @Delete(':type/records/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archiveRecord(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Param('id', ParseIntPipe) id: number,
    @Query('expectedVersion', ParseIntPipe) expectedVersion: number,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.bookingDocuments.archiveRecord(
      type,
      id,
      this.requireActorUserId(request),
      expectedVersion,
    );
  }

  /** Admin-only: restore a soft-archived record into the active history list. */
  @Post(':type/records/:id/restore')
  @ApiAdminOnly()
  restoreRecord(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Param('id', ParseIntPipe) id: number,
    @Body('expectedVersion', ParseIntPipe) expectedVersion: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.bookingDocuments.restoreRecord(
      type,
      id,
      this.requireActorUserId(request),
      expectedVersion,
    );
  }

  @Delete(':type/records/:id/permanent')
  @HttpCode(HttpStatus.NO_CONTENT)
  @PermanentDelete({
    resourceType: 'booking_document_record',
    idSource: { kind: 'param', key: 'id' },
  })
  async permanentDeleteRecord(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.bookingDocuments.permanentDeleteRecord(type, id);
  }

  @Post(':type/preview')
  @HttpCode(HttpStatus.OK)
  async preview(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const preview = await this.bookingDocuments.createPreview(
      type,
      body,
      request.user?.id,
    );
    this.sendPreview(response, preview);
  }

  private sendPreview(
    response: Response,
    preview: { data: Buffer; filename: string },
  ): void {
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
