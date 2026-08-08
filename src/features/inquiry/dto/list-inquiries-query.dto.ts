import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
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

  /**
   * Keyset cursor (pair with cursorId). When both are set, list uses
   * (submitted_at, id) keyset instead of OFFSET — preferred for deep pages.
   */
  @IsOptional()
  @IsDateString()
  cursorSubmittedAt?: string;

  @ValidateIf((o: ListInquiriesQueryDto) => o.cursorSubmittedAt != null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cursorId?: number;

  /** Display name, e.g. `SHIPPING AGENCY` */
  @IsOptional()
  @Transform(({ value, obj }: TransformFnParams) => {
    const transformedValue: unknown = value;
    const source: unknown = obj;
    const serviceSlug =
      typeof source === 'object' && source !== null && 'serviceSlug' in source
        ? source.serviceSlug
        : undefined;
    const raw = transformedValue ?? serviceSlug;
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
   * Free-text search over code, full name, company, email, status, and
   * shipping-agency MV (server-side; drives totalElements).
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim() : value,
  )
  q?: string;

  /** Inclusive lower bound on submitted_at (ISO-8601). */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Inclusive upper bound on submitted_at (ISO-8601). */
  @IsOptional()
  @IsDateString()
  dateTo?: string;

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
