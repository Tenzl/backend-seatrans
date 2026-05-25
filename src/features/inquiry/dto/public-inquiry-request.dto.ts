import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { RequireServiceTypeReference } from '../../../shared/validators/require-one-of.validator';

@RequireServiceTypeReference({
  message: 'Either serviceTypeId or serviceTypeSlug is required',
})
export class PublicInquiryRequestDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceTypeId?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  serviceTypeSlug?: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  shipownerTo?: string;

  @IsOptional()
  @IsString()
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
  @IsString()
  cargoQuantity?: string;

  @IsOptional()
  @IsString()
  loadingPort?: string;

  @IsOptional()
  @IsString()
  dischargingPort?: string;

  @IsOptional()
  @IsDateString()
  laycanFrom?: string;

  @IsOptional()
  @IsDateString()
  laycanTo?: string;

  @IsOptional()
  @IsString()
  deliveryTerm?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  container20?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  container40?: number;

  @IsOptional()
  @IsDateString()
  shipmentFrom?: string;

  @IsOptional()
  @IsDateString()
  shipmentTo?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  subject?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  preferredProvinceId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  relatedDepartmentId?: number;

  @IsOptional()
  @IsString()
  message?: string;
}
