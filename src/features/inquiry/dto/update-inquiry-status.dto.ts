import { IsEnum } from 'class-validator';
import { InquiryStatus } from '../enums/inquiry-status.enum';

export class UpdateInquiryStatusDto {
  @IsEnum(InquiryStatus)
  status!: InquiryStatus;
}
