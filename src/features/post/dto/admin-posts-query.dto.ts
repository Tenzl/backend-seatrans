import { Transform, type TransformFnParams } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../shared/dto/pagination.dto';

export class AdminPostsQueryDto extends PaginationQueryDto {
  /** Title search (list projection; no full HTML body). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim() : value,
  )
  q?: string;
}
