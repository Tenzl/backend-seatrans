import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AdminSection } from '../../shared/decorators/admin-section.decorator';
import { BookingDocumentsService } from './booking-documents.service';
import { BOOKING_DOCUMENT_SECTION } from './constants/booking-document.constants';
import { BookingDocumentType } from './enums/booking-document-type.enum';

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

  @Post(':type/records')
  @HttpCode(HttpStatus.CREATED)
  createRecord(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Body() body: unknown,
    @Req() request: Request & { user?: { id?: number } },
  ) {
    const userId = request.user?.id;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }
    return this.bookingDocuments.createRecord(type, body, userId);
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

  private toInteger(value: string, fallback: number): number {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
