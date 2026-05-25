import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CategoryRequestDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(150)
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
