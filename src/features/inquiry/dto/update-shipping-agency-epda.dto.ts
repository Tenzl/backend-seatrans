import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ConfirmedCustomerFieldChangeDto } from './confirmed-customer-field-change.dto';
import {
  EPDA_QUOTE_FORMS,
  type EpdaQuoteForm,
} from '../constants/epda-quote-form';
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
  shipownerTo?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  vesselName?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  grt?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  dwt?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  loa?: number | null;

  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    const input: unknown = value;
    if (input === null || input === '') return null;
    const parsed = Number(input);
    return Number.isInteger(parsed) ? parsed : input;
  })
  @IsInt()
  @Min(1)
  portId?: number | null;

  @IsOptional()
  @IsDateString()
  eta?: string | null;

  @IsOptional()
  @IsString()
  cargoType?: string | null;

  @IsOptional()
  @IsString()
  cargoName?: string | null;

  @IsOptional()
  @IsString()
  cargoNameOther?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  quantityTons?: number | null;

  @IsOptional()
  @IsString()
  frtTaxType?: string | null;

  @IsOptional()
  @IsString()
  purposeOfCalling?: string | null;

  @IsOptional()
  @IsString()
  portOfCall?: string | null;

  @IsOptional()
  @IsString()
  dischargeLoadingLocation?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  boatHireAmount?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tallyFeeAmount?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tugAssistanceAmount?: number | null;

  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    const input: unknown = value;
    if (input === null || input === undefined || input === '') return null;
    const n = Number(input);
    return Number.isFinite(n) ? n : input;
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsNumber()
  @Min(0)
  shorecraneHireUsdPerMt?: number | null;

  @IsOptional()
  @IsString()
  transportLs?: string | null;

  @IsOptional()
  @IsString()
  transportQuarantine?: string | null;

  @IsOptional()
  @IsIn(EPDA_QUOTE_FORMS)
  quoteForm?: EpdaQuoteForm;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  berthHours?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  anchorageHours?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pilotage3rdMiles?: number | null;

  @IsOptional()
  @IsDateString()
  epdaDocumentDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  shipType?: string | null;

  @IsOptional()
  @IsIn(['OVERSEAS', 'VIETNAMESE'])
  shipownerNationality?: 'OVERSEAS' | 'VIETNAMESE' | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  oceanFrtRateUsdPerMt?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  garbageCbmAmount?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  garbageUsdRate?: number | null;

  @IsOptional()
  @IsIn(QUARANTINE_MODES)
  quarantineCargoMode?: (typeof QUARANTINE_MODES)[number] | null;

  @IsOptional()
  @IsIn(AGENCY_FEE_MODES)
  agencyFeeMode?: (typeof AGENCY_FEE_MODES)[number] | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  agencyDiscountPercent?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  agencyLumpsumAmount?: number | null;

  /** Render-ready quote payload from admin UI (optional draft save). */
  @IsOptional()
  @IsObject()
  epdaSnapshot?: Record<string, unknown>;

  /** Staff-confirmed overrides of customer-submitted values (audit log). */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ConfirmedCustomerFieldChangeDto)
  confirmedCustomerFieldChanges?: ConfirmedCustomerFieldChangeDto[];

  /**
   * Whether all required EPDA fields are filled (computed by the admin UI).
   * Drives the draft status: true → COMPLETED, false → PROCESSING.
   */
  @IsOptional()
  @IsBoolean()
  isComplete?: boolean;
}
