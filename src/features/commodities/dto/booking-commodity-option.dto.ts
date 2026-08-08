export class BookingCommodityOptionDto {
  id: number;
  commodityName: string;
  groupName: string;
  /** Exact `{commodityName} IN {groupName}` for booking + AN description of goods. */
  displayLabel: string;
}
