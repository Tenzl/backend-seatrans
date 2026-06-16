/**
 * Canonical catalog of dashboard "sections" (one per page). A role is granted
 * access to a set of these keys; the frontend uses the same keys to gate nav +
 * routes, and the SectionAccessGuard uses them to gate the matching admin APIs.
 *
 * Keep this list in sync with the frontend catalog
 * (dashboard_admin/src/config/section-catalog.ts).
 */
export interface SectionDef {
  key: string;
  label: string;
  group: string;
  /**
   * Admin-only sections can't be granted to other roles — they are privilege
   * boundaries (e.g. user management can assign admin roles → escalation; role
   * management can grant any access). Only admin roles ever hold these.
   */
  adminOnly?: boolean;
}

export const SECTION_CATALOG: readonly SectionDef[] = [
  { key: 'epda-create', label: 'Create EPDA', group: 'EPDA' },
  { key: 'epda-inquiry', label: 'Inquiry', group: 'EPDA' },
  { key: 'epda-parameter', label: 'Parameter', group: 'EPDA' },
  { key: 'booking-partner', label: 'Partner', group: 'Booking Management' },
  { key: 'booking-shipment', label: 'Shipment', group: 'Booking Management' },
  { key: 'users', label: 'Users', group: 'Data Management', adminOnly: true },
  { key: 'data-ports', label: 'Ports', group: 'Data Management' },
  { key: 'data-cargo', label: 'Cargo', group: 'Data Management' },
  { key: 'data-images', label: 'Images', group: 'Data Management' },
  { key: 'data-offices', label: 'Offices', group: 'Data Management' },
  { key: 'content-posts', label: 'Posts', group: 'Content Management' },
  { key: 'content-categories', label: 'Categories', group: 'Content Management' },
  { key: 'roles', label: 'Roles & access', group: 'Administration', adminOnly: true },
] as const;

export const SECTION_KEYS: readonly string[] = SECTION_CATALOG.map((s) => s.key);

/** Sections an admin may grant to other roles (excludes admin-only boundaries). */
export const GRANTABLE_SECTION_KEYS: readonly string[] = SECTION_CATALOG.filter(
  (s) => !s.adminOnly,
).map((s) => s.key);

export function isValidSectionKey(key: string): boolean {
  return SECTION_KEYS.includes(key);
}
