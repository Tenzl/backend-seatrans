import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Add a commodity to an existing group (POST .../groups/:id/commodities). */
export class AddCommodityToGroupDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(200)
  displayName!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  requiredImageCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cargoType?: string;
}
