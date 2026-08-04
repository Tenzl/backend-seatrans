import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingDocumentRecordService } from './booking-document-record.service';
import { BookingDocumentsAdminController } from './booking-documents-admin.controller';
import { BookingDocumentPayloadValidator } from './booking-document-payload.validator';
import { BookingDocumentsService } from './booking-documents.service';
import { ArrivalNoticeRecord } from './entities/arrival-notice-record.entity';
import { BillOfLadingRecord } from './entities/bill-of-lading-record.entity';
import { BookingRecord } from './entities/booking-record.entity';
import { DeliveryOrderRecord } from './entities/delivery-order-record.entity';
import { BookingDocumentPdfRenderer } from './rendering/booking-document-pdf.renderer';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BookingRecord,
      ArrivalNoticeRecord,
      DeliveryOrderRecord,
      BillOfLadingRecord,
    ]),
  ],
  controllers: [BookingDocumentsAdminController],
  providers: [
    BookingDocumentRecordService,
    BookingDocumentPayloadValidator,
    BookingDocumentPdfRenderer,
    BookingDocumentsService,
  ],
})
export class BookingDocumentsModule {}
