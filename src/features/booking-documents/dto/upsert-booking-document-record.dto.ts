import { IsEnum, IsInt, IsOptional, IsPositive } from 'class-validator';
import { BookingFlow } from '../enums/booking-flow.enum';

/** Workflow metadata and concurrency token alongside document form fields. */
export class UpsertBookingDocumentRecordDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  expectedVersion?: number;

  @IsOptional()
  @IsEnum(BookingFlow)
  bookingFlow?: BookingFlow;

  @IsOptional()
  @IsInt()
  @IsPositive()
  bookingId?: number;
}
