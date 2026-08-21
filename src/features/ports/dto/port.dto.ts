import type { PortType } from '../entities/port.entity';

export class PortDto {
  id: number;
  name: string;
  subName1: string | null;
  subName2: string | null;
  portOfCall: string;
  provinceId: number | null;
  provinceName: string | null;
  provinceArea: number | null;
  zoneCode: string | null;
  countryCode: string | null;
  code: string | null;
  longitude: string | null;
  latitude: string | null;
  type: PortType;
  inCharge: boolean;
  isActive: boolean;
  hasInfo: number;
  createdAt: Date;
  updatedAt: Date;
}
