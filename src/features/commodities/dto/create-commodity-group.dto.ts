import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { COMMODITY_ADMIN_SERVICE_SLUGS } from '../commodity-service-scope';

export class CreateGroupedCommodityDto {
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

  /** Shipping-agency gallery still uses cargo type codes. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cargoType?: string;
}

export class CreateCommodityGroupDto {
  @IsIn([...COMMODITY_ADMIN_SERVICE_SLUGS])
  serviceSlug!: (typeof COMMODITY_ADMIN_SERVICE_SLUGS)[number];

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsArray()
  @ArrayMinSize(1, {
    message: 'Create group requires at least one commodity',
  })
  @ValidateNested({ each: true })
  @Type(() => CreateGroupedCommodityDto)
  commodities!: CreateGroupedCommodityDto[];
}
