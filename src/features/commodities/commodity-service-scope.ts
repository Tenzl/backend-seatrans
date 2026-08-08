/**
 * Admin commodity scopes — reuse inquiry/service slugs; do not invent parallels.
 */
export const COMMODITY_ADMIN_SERVICE_SLUGS = [
  'shipping-agency',
  'freight-forwarding',
] as const;

export type CommodityAdminServiceSlug =
  (typeof COMMODITY_ADMIN_SERVICE_SLUGS)[number];

export const FREIGHT_FORWARDING_SERVICE_SLUG: CommodityAdminServiceSlug =
  'freight-forwarding';

/** Normalize service type name / display / slug to a canonical kebab slug. */
export function toCommodityServiceSlug(
  value: string | null | undefined,
): string {
  const normalized = (value ?? '').trim().toLowerCase().replace(/_/g, ' ');
  if (
    normalized === 'shipping agency' ||
    normalized === 'shipping-agency'
  ) {
    return 'shipping-agency';
  }
  if (
    normalized === 'freight forwarding' ||
    normalized === 'freight-forwarding'
  ) {
    return 'freight-forwarding';
  }
  return normalized.replace(/\s+/g, '-');
}

export function isCommodityAdminServiceSlug(
  value: string,
): value is CommodityAdminServiceSlug {
  return (COMMODITY_ADMIN_SERVICE_SLUGS as readonly string[]).includes(value);
}
