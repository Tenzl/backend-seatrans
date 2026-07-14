import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export type InquiryDeleteMode = 'soft' | 'hard';

export const CANONICAL_INQUIRY_SERVICE_SLUGS = [
  'shipping-agency',
  'chartering',
  'freight-forwarding',
  'total-logistic',
  'special-request',
] as const;

export type CanonicalInquiryServiceSlug =
  (typeof CANONICAL_INQUIRY_SERVICE_SLUGS)[number];

export class DeleteInquiriesQueryDto {
  @IsOptional()
  @IsIn(['soft', 'hard'])
  mode?: InquiryDeleteMode;

  /** Optional for admin all-service batch operations. */
  @IsOptional()
  @IsString()
  @IsIn(CANONICAL_INQUIRY_SERVICE_SLUGS)
  @MaxLength(64)
  serviceSlug?: CanonicalInquiryServiceSlug;
}

/** Public deletion must name one service because ids can overlap across tables. */
export class PublicDeleteInquiriesQueryDto {
  @IsString()
  @IsIn(CANONICAL_INQUIRY_SERVICE_SLUGS)
  @MaxLength(64)
  serviceSlug!: CanonicalInquiryServiceSlug;
}
