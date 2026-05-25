import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateGalleryImageDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  serviceTypeId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  commodityId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  provinceId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  portId?: number;
}
