import { Transform, Type, type TransformFnParams } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ListQueryDto } from '../../../shared/dto/list-query.dto';
import {
  PROVINCE_AREA_CODES,
  type ProvinceAreaCode,
  normalizeProvinceAreaCode,
} from '../../provinces/province-area';

export type PortArea = ProvinceAreaCode;

export const PORT_SEARCH_IN_VALUES = [
  'area',
  'provinceName',
  'name',
  'portOfCall',
  'code',
  'zoneCode',
  'countryCode',
] as const;
export type PortSearchIn = (typeof PORT_SEARCH_IN_VALUES)[number];

export class ListPortsQueryDto extends ListQueryDto {
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    const rawValue = value as unknown;
    const supportedValue =
      typeof rawValue === 'string' || typeof rawValue === 'number'
        ? rawValue
        : rawValue == null
          ? rawValue
          : undefined;
    return normalizeProvinceAreaCode(supportedValue) ?? rawValue;
  })
  @Type(() => Number)
  @IsIn(PROVINCE_AREA_CODES)
  area?: PortArea;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  provinceId?: number;

  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    const rawValue = value as unknown;
    return rawValue === 'true' || rawValue === true;
  })
  @IsBoolean()
  active?: boolean;

  /** Column to apply `q` against (default: name) */
  @IsOptional()
  @IsIn(PORT_SEARCH_IN_VALUES)
  searchIn?: PortSearchIn;
}
