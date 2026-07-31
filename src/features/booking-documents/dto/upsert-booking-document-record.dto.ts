import { IsEnum, IsOptional } from 'class-validator';
import { BookingDocumentStatus } from '../enums/booking-document-status.enum';

/**
 * Create/update envelope. Form fields live alongside `status` in the body;
 * the service strips `status` before payload validation.
 */
export class UpsertBookingDocumentRecordDto {
  @IsOptional()
  @IsEnum(BookingDocumentStatus)
  status?: BookingDocumentStatus;
}
