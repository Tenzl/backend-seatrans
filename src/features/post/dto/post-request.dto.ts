import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class PostRequestDto {
  @IsString()
  @MaxLength(500)
  title!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  categoryIds?: number[];

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  thumbnailPublicId?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
