import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateGalleryImageDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  imageUrl?: string;

  @IsInt()
  @Min(1)
  serviceTypeId!: number;

  @IsInt()
  @Min(1)
  commodityId!: number;

  @IsInt()
  @Min(1)
  provinceId!: number;

  @IsInt()
  @Min(1)
  portId!: number;
}
