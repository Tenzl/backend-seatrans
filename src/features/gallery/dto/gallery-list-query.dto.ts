import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { API_MAX_PAGE_SIZE } from '../../../shared/dto/list-query.dto';

export class GalleryListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceTypeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  commodityId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  provinceId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  portId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(API_MAX_PAGE_SIZE)
  size?: number = 100;

  @IsOptional()
  @IsString()
  q?: string;

  /** Return full list (admin export) instead of paginated slice */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unpaged?: boolean;
}
