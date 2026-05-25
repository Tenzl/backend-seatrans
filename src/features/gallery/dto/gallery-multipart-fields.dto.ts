import { Transform, Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { CreateGalleryImageDto } from './create-gallery-image.dto';

/** Multipart form fields (camelCase or legacy snake_case). */
export class GalleryMultipartFieldsDto {
  @Transform(({ obj }) =>
    Number(obj.provinceId ?? obj.province_id),
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  provinceId!: number;

  @Transform(({ obj }) => Number(obj.portId ?? obj.port_id))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  portId!: number;

  @Transform(({ obj }) =>
    Number(obj.serviceTypeId ?? obj.service_type_id),
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceTypeId!: number;

  @Transform(({ obj }) =>
    Number(obj.commodityId ?? obj.commodity_id),
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  commodityId!: number;

  toCreateDto(): CreateGalleryImageDto {
    return {
      provinceId: this.provinceId,
      portId: this.portId,
      serviceTypeId: this.serviceTypeId,
      commodityId: this.commodityId,
    };
  }
}
