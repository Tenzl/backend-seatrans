import { Type } from 'class-transformer';
import { IsNumber, IsOptional } from 'class-validator';

export class UpdateInquiryHoursDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  berthHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  anchorageHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pilotage3rdMiles?: number;
}
