import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CommodityTypeDto {
  id!: number;
  serviceTypeId!: number;
  name!: string;
  createdAt!: string;
  updatedAt!: string;
}

export class ListCommodityTypesQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceTypeId!: number;
}

export class CreateCommodityTypeDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceTypeId!: number;

  @IsString()
  @MaxLength(200)
  name!: string;
}

export class UpdateCommodityTypeDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceTypeId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}
