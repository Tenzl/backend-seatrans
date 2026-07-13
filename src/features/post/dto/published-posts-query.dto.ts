import { Transform, type TransformFnParams } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../shared/dto/pagination.dto';

export class PublishedPostsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  /** Full-text search on title/content */
  @IsOptional()
  @IsString()
  @Transform(({ value, obj }: TransformFnParams) => {
    const rawValue = value as unknown;
    const source = obj as { search?: unknown };
    const q = rawValue ?? source.search;
    return typeof q === 'string' ? q.trim() : q;
  })
  q?: string;

  /** @deprecated Use q */
  @IsOptional()
  @IsString()
  search?: string;
}
