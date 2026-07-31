import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingDocumentsAdminController } from './booking-documents-admin.controller';
import { BookingDocumentHistoryService } from './booking-document-history.service';
import { BookingDocumentPayloadValidator } from './booking-document-payload.validator';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingDocumentRecord } from './entities/booking-document-record.entity';
import { BookingDocumentPdfRenderer } from './rendering/booking-document-pdf.renderer';

@Module({
  imports: [TypeOrmModule.forFeature([BookingDocumentRecord])],
  controllers: [BookingDocumentsAdminController],
  providers: [
    BookingDocumentHistoryService,
    BookingDocumentPayloadValidator,
    BookingDocumentPdfRenderer,
    BookingDocumentsService,
  ],
})
export class BookingDocumentsModule {}
