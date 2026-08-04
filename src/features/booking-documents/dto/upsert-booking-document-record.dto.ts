import { IsEnum, IsInt, IsOptional, IsPositive } from 'class-validator';
import { BookingDocumentStatus } from '../enums/booking-document-status.enum';
import { BookingFlow } from '../enums/booking-flow.enum';

/**
 * Create/update envelope. Form fields live alongside `status` in the body;
 * the service strips `status` before payload validation.
 */
export class UpsertBookingDocumentRecordDto {
  @IsOptional()
  @IsEnum(BookingDocumentStatus)
  status?: BookingDocumentStatus;

  @IsOptional()
  @IsEnum(BookingFlow)
  bookingFlow?: BookingFlow;

  @IsOptional()
  @IsInt()
  @IsPositive()
  bookingId?: number;
}
