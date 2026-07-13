import { Transform, Type, type TransformFnParams } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { CreateGalleryImageDto } from './create-gallery-image.dto';

function readMultipartField(
  source: unknown,
  camelCaseKey: string,
  snakeCaseKey: string,
): unknown {
  if (typeof source !== 'object' || source === null) {
    return undefined;
  }

  const fields = source as Record<string, unknown>;
  return fields[camelCaseKey] ?? fields[snakeCaseKey];
}

/** Multipart form fields (camelCase or legacy snake_case). */
export class GalleryMultipartFieldsDto {
  @Transform(({ obj }: TransformFnParams) =>
    Number(readMultipartField(obj as unknown, 'provinceId', 'province_id')),
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  provinceId!: number;

  @Transform(({ obj }: TransformFnParams) =>
    Number(readMultipartField(obj as unknown, 'portId', 'port_id')),
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  portId!: number;

  @Transform(({ obj }: TransformFnParams) =>
    Number(
      readMultipartField(obj as unknown, 'serviceTypeId', 'service_type_id'),
    ),
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceTypeId!: number;

  @Transform(({ obj }: TransformFnParams) =>
    Number(readMultipartField(obj as unknown, 'commodityId', 'commodity_id')),
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
