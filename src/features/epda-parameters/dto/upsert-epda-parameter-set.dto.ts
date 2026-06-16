import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

class HoursDto {
  @IsOptional() @IsNumber() berthHours?: number;
  @IsOptional() @IsNumber() anchorageHours?: number;
  @IsOptional() @IsNumber() pilotageThirdMiles?: number;
  @IsOptional() @IsNumber() qnPilotageMiles?: number;
}

class GarbageDto {
  @IsOptional() @IsNumber() atBerthUsd?: number;
  @IsOptional() @IsNumber() atBuoyUsd?: number;
  @IsOptional() @IsNumber() cbmAmount?: number;
}

class QuarantineDto {
  @IsOptional() @IsNumber() shipUnitLowGrt?: number;
  @IsOptional() @IsNumber() shipUnitHighGrt?: number;
  @IsOptional() @IsNumber() shipThresholdGrt?: number;
  @IsOptional() @IsNumber() cargoPerTrip?: number;
}

class CoeffDto {
  @IsOptional() @IsNumber() tonnagePerGrt?: number;
  @IsOptional() @IsNumber() navigationPerGrt?: number;
  @IsOptional() @IsNumber() tankerFactor?: number;
  @IsOptional() @IsNumber() bulkFactor?: number;
  @IsOptional() @IsNumber() berthDuePerGrtHour?: number;
  @IsOptional() @IsNumber() buoyDuePerGrtHour?: number;
  @IsOptional() @IsNumber() anchoragePerGrtHour?: number;
  @IsOptional() @IsNumber() clearanceFee?: number;
  @IsOptional() @IsNumber() oceanFrtDefaultRate?: number;
  @IsOptional() @IsNumber() oceanFrtTaxRate?: number;
  @IsOptional() @IsNumber() pilotageLeg1Rate?: number;
  @IsOptional() @IsNumber() pilotageLeg1Miles?: number;
  @IsOptional() @IsNumber() pilotageLeg2Rate?: number;
  @IsOptional() @IsNumber() pilotageLeg2Miles?: number;
  @IsOptional() @IsNumber() pilotageLeg3Rate?: number;
  @IsOptional() @IsNumber() pilotageSingleRate?: number;
  @IsOptional() @IsNumber() pilotageMinAmount?: number;
  @IsOptional() @IsNumber() cargoAgencyBagRate?: number;
  @IsOptional() @IsNumber() cargoAgencyEquipRate?: number;
  @IsOptional() @IsNumber() cargoAgencyBulkRate?: number;
}

class GrtTierDto {
  // `null` allowed for the open-ended top tier; validate as number only when not null.
  @ValidateIf((o) => o.maxGrt !== null) @IsNumber() maxGrt!: number | null;
  @IsNumber() amount!: number;
  @IsString() label!: string;
}

class LoaTierDto {
  @IsNumber() minLoa!: number;
  @IsNumber() amount!: number;
  @IsString() label!: string;
}

class CargoAgencyRateDto {
  @IsString() code!: string;
  @IsString() label!: string;
  @IsNumber() rate!: number;
}

export class EpdaParameterValuesDto {
  @IsOptional() @ValidateNested() @Type(() => HoursDto) hours?: HoursDto;
  @IsOptional() @ValidateNested() @Type(() => GarbageDto) garbage?: GarbageDto;
  @IsOptional() @ValidateNested() @Type(() => QuarantineDto) quarantine?: QuarantineDto;
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
}

/** Create a new port group inside an area. */
export class CreateEpdaParameterGroupDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  area!: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  name!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => EpdaParameterValuesDto)
  values?: EpdaParameterValuesDto;
}

/** Update a group's name and/or its override values. */
export class UpdateEpdaParameterGroupDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => EpdaParameterValuesDto)
  values?: EpdaParameterValuesDto;
}

/** Replace a group's member port list. */
export class SetGroupMembersDto {
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Type(() => Number)
  portIds!: number[];
}
