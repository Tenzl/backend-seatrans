import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CreateGalleryImageDto } from './create-gallery-image.dto';
import { GalleryListQueryDto } from './gallery-list-query.dto';
import { UpdateGalleryImageDto } from './update-gallery-image.dto';

export class GalleryImageDto {
  id!: number;
  imageUrl!: string;
  cloudinaryPublicId!: string | null;
  uploadedAt!: Date;
  uploadedById!: number;
  serviceTypeId!: number;
  commodityId!: number;
  commodityName!: string;
  commodityTypeId!: number | null;
  commodityTypeName!: string | null;
  provinceId!: number | null;
  provinceName!: string | null;
  portId!: number | null;
  portName!: string | null;
  provinceCode!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class CreateGalleryImageWithTypeDto extends CreateGalleryImageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  commodityTypeId?: number | null;
}

export class UpdateGalleryImageWithTypeDto extends UpdateGalleryImageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  commodityTypeId?: number | null;
}

export class GalleryListWithTypeQueryDto extends GalleryListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  commodityTypeId?: number;
}
