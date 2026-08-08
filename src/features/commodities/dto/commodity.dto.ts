export class CommodityDto {
  id: number;
  serviceTypeId: number;
  groupId: number | null;
  groupName: string | null;
  name: string;
  displayName: string;
  description: string | null;
  requiredImageCount: number;
  cargoType: string;
}
