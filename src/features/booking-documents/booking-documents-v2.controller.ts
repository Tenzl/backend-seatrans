import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminSection } from '../../shared/decorators/admin-section.decorator';
import { BOOKING_DOCUMENT_SECTION } from './constants/booking-document.constants';
import { BookingDocumentsV2Service } from './booking-documents-v2.service';
import { BookingDocumentType } from './enums/booking-document-type.enum';

type AuthenticatedRequest = Request & { user?: { id?: number } };

@AdminSection(BOOKING_DOCUMENT_SECTION)
@Controller('v2/admin/booking-documents')
export class BookingDocumentsV2Controller {
  constructor(private readonly documents: BookingDocumentsV2Service) {}

  @Get('reports/bookings')
  report(@Query() query: Record<string, string | undefined>) {
    return this.documents.report(query);
  }

  @Get(':type/records')
  list(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Query('page') page = '0',
    @Query('size') size = '10',
    @Query('bookingNo') bookingNo = '',
  ) {
    return this.documents.list(type, Number(page), Number(size), bookingNo);
  }

  @Get(':type/records/:id')
  get(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.documents.get(type, id);
  }

  @Post(':type/records')
  create(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.create(type, body, this.actor(request));
  }

  @Put(':type/records/:id')
  update(
    @Param('type', new ParseEnumPipe(BookingDocumentType))
    type: BookingDocumentType,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.update(type, id, body, this.actor(request));
  }

  private actor(request: AuthenticatedRequest): number {
    if (!request.user?.id)
      throw new BadRequestException('User not authenticated');
    return request.user.id;
  }
}
