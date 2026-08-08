import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { UpsertBookingPartnerDto } from './upsert-booking-partner.dto';
import { BOOKING_PARTNER_IMPORT_MAX_ROWS } from '../constants/booking-partner-import.limits';

/** Commit import from previewed rows without re-uploading / re-parsing the workbook. */
export class CommitBookingPartnerImportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BOOKING_PARTNER_IMPORT_MAX_ROWS)
  @ValidateNested({ each: true })
  @Type(() => UpsertBookingPartnerDto)
  rows!: UpsertBookingPartnerDto[];
}
