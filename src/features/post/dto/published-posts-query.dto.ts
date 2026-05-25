import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../shared/dto/pagination.dto';

export class PublishedPostsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  /** Full-text search on title/content */
  @IsOptional()
  @IsString()
  @Transform(({ value, obj }) => {
    const q = value ?? obj.search;
    return typeof q === 'string' ? q.trim() : q;
  })
  q?: string;

  /** @deprecated Use q */
  @IsOptional()
  @IsString()
  search?: string;
}
