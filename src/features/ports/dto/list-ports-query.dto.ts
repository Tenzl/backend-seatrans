import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ListQueryDto } from '../../../shared/dto/list-query.dto';

export const PORT_AREA_VALUES = ['NORTHERN', 'MIDDLE', 'SOUTHERN'] as const;
export type PortArea = (typeof PORT_AREA_VALUES)[number];

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
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(PORT_AREA_VALUES)
  area?: PortArea;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  provinceId?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  active?: boolean;

  /** Column to apply `q` against (default: name) */
  @IsOptional()
  @IsIn(PORT_SEARCH_IN_VALUES)
  searchIn?: PortSearchIn;
}
