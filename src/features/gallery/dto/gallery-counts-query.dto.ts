import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class GalleryCountsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceTypeId?: number;

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
}
