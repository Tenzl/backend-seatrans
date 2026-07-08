import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PROVINCE_AREA_CODES } from '../province-area';

export class CreateProvinceDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  code?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(PROVINCE_AREA_CODES)
  area?: number;
}
