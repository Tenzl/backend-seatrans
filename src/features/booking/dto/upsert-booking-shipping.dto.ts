import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class BookingTransitLegRequestDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  portId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder!: number;

  @IsOptional()
  @IsDateString()
  eta?: string;

  @IsOptional()
  @IsDateString()
  etd?: string;
}

export class UpsertBookingShippingDto {
  @IsString()
  @IsNotEmpty()
  bookingNo!: string;

  @IsOptional()
  @IsString()
  bookingTo?: string;

  @IsOptional()
  @IsString()
  bookingNumberReference?: string;

  @IsOptional()
  @IsString()
  bookingNote?: string;

  @IsOptional()
  @IsString()
  serviceMode?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  placeOfReceiptPortId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  portOfLoadingPortId?: number;

  @IsOptional()
  @IsString()
  pickUp?: string;

  @IsOptional()
  @IsDateString()
  etd?: string;

  @IsOptional()
  @IsDateString()
  dateOfPickUp?: string;

  @IsOptional()
  @IsString()
  dropOffWarehouse?: string;

  @IsOptional()
  @IsString()
  feederVessel?: string;

  @IsOptional()
  @IsString()
  feederVoyage?: string;

  @IsOptional()
  @IsString()
  motherVessel?: string;

  @IsOptional()
  @IsString()
  motherVoyage?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  carrier?: string;

  @IsOptional()
  @IsDateString()
  cyCutOff?: string;

  @IsOptional()
  @IsDateString()
  siCutOff?: string;

  @IsOptional()
  @IsDateString()
  vgmCutOff?: string;

  @IsOptional()
  @IsDateString()
  gateIn?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  temp?: number;

  @IsOptional()
  @IsString()
  vent?: string;

  @IsOptional()
  @IsString()
  freightTerms?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  portOfDischargePortId?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  placeOfDeliveryPortId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  finalDestinationPortId?: number;

  @IsOptional()
  @IsDateString()
  eta?: string;

  @IsOptional()
  @IsString()
  volume?: string;

  @IsOptional()
  @IsString()
  cargoType?: string;

  @IsOptional()
  @IsString()
  cargoName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  grossWeightKgs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  measurementCbm?: number;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsString()
  specialRemark?: string;

  @IsOptional()
  @IsDateString()
  dateOfCreation?: string;

  @IsOptional()
  @IsString()
  termsAndConditions?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingTransitLegRequestDto)
  transitLegs?: BookingTransitLegRequestDto[];
}
