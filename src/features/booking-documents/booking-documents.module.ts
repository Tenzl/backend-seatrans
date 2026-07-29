import { Module } from '@nestjs/common';
import { BookingDocumentsAdminController } from './booking-documents-admin.controller';
import { BookingDocumentsService } from './booking-documents.service';

@Module({
  controllers: [BookingDocumentsAdminController],
  providers: [BookingDocumentsService],
})
export class BookingDocumentsModule {}
