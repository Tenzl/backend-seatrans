import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Default max page size for offset pagination (api-design: cap list payloads) */
export const API_MAX_PAGE_SIZE = 100;

export class ListQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

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
  size?: number = 20;

  /** Comma-separated sort, e.g. `-updatedAt,name` */
  @IsOptional()
  @IsString()
  sort?: string;
}

export class LimitQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(API_MAX_PAGE_SIZE)
  limit?: number;
}
