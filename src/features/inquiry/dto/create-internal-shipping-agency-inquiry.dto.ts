import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const QUOTE_FORMS = ['HCM', 'QN'] as const;

/**
 * Internal-only: create shipping agency inquiry with EPDA fields pre-filled.
 */
export class CreateInternalShippingAgencyInquiryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customerUserId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  shipownerTo!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  vesselName!: string;

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
  frtTaxType?: string;

  @IsOptional()
  @IsString()
  purposeOfCalling?: string;

  @IsString()
  @IsNotEmpty()
  portOfCall!: string;

  @IsString()
  @IsNotEmpty()
  dischargeLoadingLocation!: string;

  @IsIn(QUOTE_FORMS)
  quoteForm!: (typeof QUOTE_FORMS)[number];

  @IsOptional()
  @IsDateString()
  epdaDocumentDate?: string;

  @IsOptional()
  @IsString()
  shipType?: string;

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
  garbageCbmAmount?: number;

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

  @IsOptional()
  @IsObject()
  epdaSnapshot?: Record<string, unknown>;
}
