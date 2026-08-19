export const COMMODITY_USAGE_CHECKER = Symbol('COMMODITY_USAGE_CHECKER');

export type CommodityUsageIdentity = {
  id: number;
  name: string;
  displayName: string;
};

export type CommodityTypeUsageIdentity = {
  id: number;
  name: string;
};

/**
 * Application port: does any gallery image or inquiry still reference this
 * commodity? Keeps CommoditiesService free of foreign TypeORM repositories.
 */
export interface CommodityUsageChecker {
  isInUse(commodity: CommodityUsageIdentity): Promise<boolean>;
  isTypeInUse?(commodityType: CommodityTypeUsageIdentity): Promise<boolean>;
}
