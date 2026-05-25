import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateProvinceDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  code?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  area?: string;
}
