import { IsOptional, IsString, MaxLength } from 'class-validator';

/** PATCH body — currently supports renaming `name` (unique per service type). */
export class UpdateCommodityGroupDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}
