import { CommodityDto } from './commodity.dto';
import type { CommodityAdminServiceSlug } from '../commodity-service-scope';

export class CommodityGroupDto {
  id: number;
  serviceTypeId: number;
  serviceSlug: CommodityAdminServiceSlug | string;
  name: string;
  commodities: CommodityDto[];
  createdAt: string;
  updatedAt: string;
}
