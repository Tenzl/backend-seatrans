import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateCommodityDto {
  @IsInt()
  @Min(1)
  serviceTypeId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsString()
  @MaxLength(200)
  displayName!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
