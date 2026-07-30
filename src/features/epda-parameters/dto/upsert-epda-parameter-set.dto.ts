import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

class HoursDto {
  @IsOptional() @IsNumber() @Min(0) berthHours?: number;
  @IsOptional() @IsNumber() @Min(0) anchorageHours?: number;
  @IsOptional() @IsNumber() @Min(0) pilotageThirdMiles?: number;
  @IsOptional() @IsNumber() @Min(0) qnPilotageMiles?: number;
}

class GarbageDto {
  @IsOptional() @IsNumber() @Min(0) atBerthUsd?: number;
  @IsOptional() @IsNumber() @Min(0) atBuoyUsd?: number;
}

class QuarantineDto {
  @IsOptional() @IsNumber() @Min(0) shipUnitLowGrt?: number;
  @IsOptional() @IsNumber() @Min(0) shipUnitHighGrt?: number;
  @IsOptional() @IsNumber() @Min(0) shipThresholdGrt?: number;
  @IsOptional() @IsNumber() @Min(0) cargoPerTrip?: number;
}

class CoeffDto {
  @IsOptional() @IsNumber() @Min(0) tonnagePerGrt?: number;
  @IsOptional() @IsNumber() @Min(0) navigationPerGrt?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) tankerFactor?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) bulkFactor?: number;
  @IsOptional() @IsNumber() @Min(0) berthDuePerGrtHour?: number;
  @IsOptional() @IsNumber() @Min(0) buoyDuePerGrtHour?: number;
  @IsOptional() @IsNumber() @Min(0) anchoragePerGrtHour?: number;
  @IsOptional() @IsNumber() @Min(0) clearanceFee?: number;
  @IsOptional() @IsNumber() @Min(0) oceanFrtDefaultRate?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) oceanFrtTaxRate?: number;
  @IsOptional() @IsNumber() @Min(0) pilotageLeg1Rate?: number;
  @IsOptional() @IsNumber() @Min(0) pilotageLeg1Miles?: number;
  @IsOptional() @IsNumber() @Min(0) pilotageLeg2Rate?: number;
  @IsOptional() @IsNumber() @Min(0) pilotageLeg2Miles?: number;
  @IsOptional() @IsNumber() @Min(0) pilotageLeg3Rate?: number;
  @IsOptional() @IsNumber() @Min(0) pilotageSingleRate?: number;
  @IsOptional() @IsNumber() @Min(0) pilotageMinAmount?: number;
  @IsOptional() @IsNumber() @Min(0) cargoAgencyBagRate?: number;
  @IsOptional() @IsNumber() @Min(0) cargoAgencyEquipRate?: number;
  @IsOptional() @IsNumber() @Min(0) cargoAgencyBulkRate?: number;
}

class GrtTierDto {
  // `null` allowed for the open-ended top tier; validate as number only when not null.
  @ValidateIf((tier: GrtTierDto) => tier.maxGrt !== null)
  @IsNumber()
  @Min(0)
  maxGrt!: number | null;
  @IsNumber() @Min(0) amount!: number;
  @IsString() @IsNotEmpty() @MaxLength(100) label!: string;
}

class LoaTierDto {
  @IsNumber() @Min(0) minLoa!: number;
  @IsNumber() @Min(0) amount!: number;
  @IsString() @IsNotEmpty() @MaxLength(100) label!: string;
}

class CargoAgencyRateDto {
  @IsString() @IsNotEmpty() @MaxLength(50) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) label!: string;
  @IsNumber() @Min(0) rate!: number;
}

export class EpdaParameterValuesDto {
  @IsOptional() @ValidateNested() @Type(() => HoursDto) hours?: HoursDto;
  @IsOptional() @ValidateNested() @Type(() => GarbageDto) garbage?: GarbageDto;
  @IsOptional()
  @ValidateNested()
  @Type(() => QuarantineDto)
  quarantine?: QuarantineDto;
  @IsOptional() @ValidateNested() @Type(() => CoeffDto) coeff?: CoeffDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GrtTierDto)
  agencyFeeTiers?: GrtTierDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GrtTierDto)
  moorUnmoorBerthTiers?: GrtTierDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GrtTierDto)
  moorUnmoorBuoyTiers?: GrtTierDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoaTierDto)
  tugTiers?: LoaTierDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CargoAgencyRateDto)
  cargoAgencyRates?: CargoAgencyRateDto[];
}

export class UpsertEpdaParameterSetDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => EpdaParameterValuesDto)
  values?: EpdaParameterValuesDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number | null;
}

/** Create a new port group inside an area. */
export class CreateEpdaParameterGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  area!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => EpdaParameterValuesDto)
  values?: EpdaParameterValuesDto;
}

/** Update a group's name and/or its override values. */
export class UpdateEpdaParameterGroupDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => EpdaParameterValuesDto)
  values?: EpdaParameterValuesDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number | null;
}

/** Replace a group's member port list. */
export class SetGroupMembersDto {
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Type(() => Number)
  portIds!: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number | null;
}
