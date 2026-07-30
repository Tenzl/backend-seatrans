import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingDocumentsAdminController } from './booking-documents-admin.controller';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingDocumentRecord } from './entities/booking-document-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BookingDocumentRecord])],
  controllers: [BookingDocumentsAdminController],
  providers: [BookingDocumentsService],
})
export class BookingDocumentsModule {}
