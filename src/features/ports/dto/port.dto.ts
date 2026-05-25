export class PortDto {
  id: number;
  name: string;
  portOfCall: string;
  provinceId: number | null;
  provinceName: string | null;
  zoneCode: string | null;
  countryCode: string | null;
  code: string | null;
  longitude: string | null;
  latitude: string | null;
  isActive: boolean;
  hasInfo: number;
  createdAt: Date;
  updatedAt: Date;
}
