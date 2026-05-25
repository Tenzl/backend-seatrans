export class ProvinceDto {
  id: number;
  name: string;
  displayName: string | null;
  code: number | null;
  area: string | null;
  portCount: number;
  ports: string[];
  isActive: boolean;
}
