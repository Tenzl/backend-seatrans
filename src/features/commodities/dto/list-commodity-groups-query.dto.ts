import { IsIn, IsOptional, IsString } from 'class-validator';
import { COMMODITY_ADMIN_SERVICE_SLUGS } from '../commodity-service-scope';

export class ListCommodityGroupsQueryDto {
  @IsOptional()
  @IsIn([...COMMODITY_ADMIN_SERVICE_SLUGS])
  serviceSlug?: (typeof COMMODITY_ADMIN_SERVICE_SLUGS)[number];

  @IsOptional()
  @IsString()
  q?: string;
}
