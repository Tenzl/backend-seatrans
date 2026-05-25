import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ListPortOptionsQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value == null || value === '') {
      return undefined;
    }
    const raw = Array.isArray(value) ? value : String(value).split(',');
    return raw.map((item) => Number(item)).filter((id) => Number.isInteger(id) && id > 0);
  })
  ids?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
