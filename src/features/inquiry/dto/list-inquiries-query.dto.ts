import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { InquiryStatus } from '../enums/inquiry-status.enum';

export type InquiryArchivedFilter = 'active' | 'archived' | 'all';

export class ListInquiriesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number = 20;

  /** Display name, e.g. `SHIPPING AGENCY` */
  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw = value ?? obj.serviceSlug;
    return typeof raw === 'string' ? raw.trim() : raw;
  })
  @IsString()
  serviceType?: string;

  /** Slug alias for serviceType, e.g. `shipping-agency` */
  @IsOptional()
  @IsString()
  serviceSlug?: string;

  @IsOptional()
  @IsEnum(InquiryStatus)
  status?: InquiryStatus;

  /**
   * Admin-only list filter:
   * - active: only rows not archived
   * - archived: only soft-deleted rows
   * - all: both
   *
   * User-facing endpoints should ignore anything except the default "active".
   */
  @IsOptional()
  @IsIn(['active', 'archived', 'all'])
  archived?: InquiryArchivedFilter = 'active';
}
