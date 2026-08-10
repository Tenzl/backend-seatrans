import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AgencyOtherExpenseDto } from './agency-other-expense.dto';
import {
  EPDA_QUOTE_FORMS,
  type EpdaQuoteForm,
} from '../constants/epda-quote-form';

/**
 * Internal-only: create shipping agency inquiry with EPDA fields pre-filled.
 */
export class CreateInternalShippingAgencyInquiryDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  shipownerTo?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  vesselName?: string | null;

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

  @Type(() => Number)
  @IsInt()
  @Min(1)
  portId!: number;

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
  @Min(0)
  quantityTons?: number;

  @IsOptional()
  @IsString()
  frtTaxType?: string;

  @IsOptional()
  @IsString()
  purposeOfCalling?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  portOfCall?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  dischargeLoadingLocation?: string | null;

  @IsOptional()
  @IsIn(EPDA_QUOTE_FORMS)
  quoteForm?: EpdaQuoteForm;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  boatHireAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tallyFeeAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tugAssistanceAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2])
  tugAssistanceTrips?: 1 | 2;

  @IsOptional()
  @IsString()
  transportLs?: string;

  @IsOptional()
  @IsString()
  transportQuarantine?: string;

  @IsOptional()
  @IsDateString()
  epdaDocumentDate?: string;

  @IsOptional()
  @IsString()
  shipType?: string;

  @IsOptional()
  @IsIn(['OVERSEAS', 'VIETNAMESE'])
  shipownerNationality?: 'OVERSEAS' | 'VIETNAMESE';

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
  @Type(() => Number)
  @IsNumber()
  oceanFrtRateUsdPerMt?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  garbageUsdRate?: number;

  @IsOptional()
  @IsString()
  quarantineCargoMode?: string;

  @IsOptional()
  @IsString()
  agencyFeeMode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  agencyDiscountPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  agencyLumpsumAmount?: number;

  /**
   * Extra agency expense lines under in-lumpsum mode.
   * Each item: `{ name, amount }`. Omit or send `[]` when unused.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AgencyOtherExpenseDto)
  agencyOtherExpenses?: AgencyOtherExpenseDto[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shorecraneHireUsdPerMt?: number;
}
