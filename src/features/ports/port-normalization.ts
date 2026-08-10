import type { PortDto } from './dto/port.dto';
import type { Port } from './entities/port.entity';

export function normalizePortName(value: string): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

export function normalizePortOfCall(
  providedPortOfCall: string | undefined,
  normalizedName: string,
): string {
  const normalizedProvided = providedPortOfCall?.trim();
  if (normalizedProvided) {
    return normalizedProvided.replace(/\s+/g, ' ').toUpperCase();
  }

  const strippedName = normalizedName
    .toUpperCase()
    .replace(/(\s+(PORT|TERMINAL|ANCHORAGE))+$/i, '')
    .trim();

  return strippedName || normalizedName.toUpperCase();
}

export function normalizeProvinceId(provinceId?: number | null): number | null {
  // Legacy province_id <= 0 is the same domain state as no province.
  if (!Number.isInteger(provinceId) || (provinceId ?? 0) <= 0) {
    return null;
  }
  return provinceId as number;
}

export function toPortDto(port: Port): PortDto {
  const provinceId = normalizeProvinceId(port.province?.id);
  const provinceName = provinceId
    ? (port.province?.displayName ?? port.province?.name ?? null)
    : null;
  const provinceArea = provinceId ? (port.province?.area ?? null) : null;

  return {
    id: port.id,
    name: port.name,
    portOfCall: port.portOfCall,
    provinceId,
    provinceName,
    provinceArea,
    zoneCode: port.zoneCode ?? null,
    countryCode: port.countryCode ?? null,
    code: port.code ?? null,
    longitude: port.longitude ?? null,
    latitude: port.latitude ?? null,
    type: port.type ?? 'PORT',
    inCharge: port.inCharge ?? false,
    isActive: port.isActive,
    hasInfo: port.hasInfo,
    createdAt: port.createdAt,
    updatedAt: port.updatedAt,
  };
}
