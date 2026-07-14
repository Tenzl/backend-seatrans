export const PROVINCE_AREA_CODES = [1, 2, 3] as const;
export type ProvinceAreaCode = (typeof PROVINCE_AREA_CODES)[number];

export const PROVINCE_AREA_LABELS: Record<ProvinceAreaCode, string> = {
  1: 'AREA 1',
  2: 'AREA 2',
  3: 'AREA 3',
};

export function normalizeProvinceAreaCode(
  value?: number | string | null,
): ProvinceAreaCode | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return PROVINCE_AREA_CODES.includes(value as ProvinceAreaCode)
      ? (value as ProvinceAreaCode)
      : null;
  }

  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  if (/^[1-3]$/.test(normalized)) {
    return Number(normalized) as ProvinceAreaCode;
  }

  return null;
}

export function getProvinceAreaLabel(value?: number | null): string | null {
  const code = normalizeProvinceAreaCode(value);
  return code ? PROVINCE_AREA_LABELS[code] : null;
}
