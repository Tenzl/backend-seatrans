import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export type InquiryDeleteMode = 'soft' | 'hard';

export class DeleteInquiriesQueryDto {
  @IsOptional()
  @IsIn(['soft', 'hard'])
  mode?: InquiryDeleteMode;

  /** When set, only the matching per-service inquiry table is queried. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  serviceSlug?: string;
}
