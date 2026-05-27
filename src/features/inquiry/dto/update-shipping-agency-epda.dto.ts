import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const QUOTE_FORMS = ['HCM', 'QN'] as const;
const QUARANTINE_MODES = [
  'ONE_LEG',
  'TWO_LEG',
  'THREE_LEG',
  'BOTH_LEGS',
  'OTHER',
] as const;
const AGENCY_FEE_MODES = [
  'TARRIF_AGENCY',
  'DISCOUNT_PERCENT',
  'LUMPSUM',
  'AGENCY_IN_LUMPSUM',
  'NOT_APPLICABLE',
] as const;

/**
 * Internal staff EPDA draft — PATCH body.
 * Customer-facing inquiry fields may be corrected here before issuing PDF.
 */
export class UpdateShippingAgencyEpdaDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  shipownerTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  vesselName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  grt?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  dwt?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  loa?: number;

  @IsOptional()
  @IsDateString()
  eta?: string;

  @IsOptional()
  @IsString()
  cargoType?: string;

  @IsOptional()
  @IsString()
  cargoName?: string;

  @IsOptional()
  @IsString()
  cargoNameOther?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  quantityTons?: number;

  @IsOptional()
  @IsString()
  frtTaxType?: string;

  @IsOptional()
  @IsString()
  purposeOfCalling?: string;

  @IsOptional()
  @IsString()
  portOfCall?: string;

  @IsOptional()
  @IsString()
  dischargeLoadingLocation?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  boatHireAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tallyFeeAmount?: number;

  @IsOptional()
  @IsString()
  transportLs?: string;

  @IsOptional()
  @IsString()
  transportQuarantine?: string;

  @IsOptional()
  @IsIn(QUOTE_FORMS)
  quoteForm?: (typeof QUOTE_FORMS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  berthHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  anchorageHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pilotage3rdMiles?: number;

  @IsOptional()
  @IsDateString()
  epdaDocumentDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  shipType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  oceanFrtRateUsdPerMt?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  garbageCbmAmount?: number;

  @IsOptional()
  @IsIn(QUARANTINE_MODES)
  quarantineCargoMode?: (typeof QUARANTINE_MODES)[number];

  @IsOptional()
  @IsIn(AGENCY_FEE_MODES)
  agencyFeeMode?: (typeof AGENCY_FEE_MODES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  agencyDiscountPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  agencyLumpsumAmount?: number;

  /** Render-ready quote payload from admin UI (optional draft save). */
  @IsOptional()
  @IsObject()
  epdaSnapshot?: Record<string, unknown>;
}
