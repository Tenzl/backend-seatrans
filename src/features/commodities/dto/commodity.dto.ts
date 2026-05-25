export class CommodityDto {
  id: number;
  serviceTypeId: number;
  name: string;
  displayName: string;
  description: string | null;
  requiredImageCount: number;
  cargoType: string;
  isActive: boolean;
}
