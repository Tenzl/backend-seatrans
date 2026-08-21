import type { PortDto } from './dto/port.dto';
import type { Port } from './entities/port.entity';

export function normalizePortName(value: string): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

export function normalizePortSubNames(
  mainName: string,
  first?: string | null,
  second?: string | null,
): [string | null, string | null] {
  const normalizedMain = normalizePortName(mainName).toLocaleLowerCase();
  const aliases: string[] = [];

  for (const candidate of [first, second]) {
    const alias = normalizePortName(candidate ?? '');
    if (!alias) continue;

    const identity = alias.toLocaleLowerCase();
    if (identity === normalizedMain) {
      throw new Error('Sub name must differ from the main name');
    }
    if (!aliases.some((value) => value.toLocaleLowerCase() === identity)) {
      aliases.push(alias);
    }
  }

  return [aliases[0] ?? null, aliases[1] ?? null];
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
    subName1: port.subName1 ?? null,
    subName2: port.subName2 ?? null,
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
