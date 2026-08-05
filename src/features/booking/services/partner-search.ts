/**
 * Build a case-insensitive SQL LIKE pattern that matches anywhere in a Party
 * field while treating user-entered wildcard characters as literal text.
 */
export function buildPartnerContainsPattern(value: string): string {
  const normalized = value.trim().toLowerCase();
  const escaped = normalized.replace(/[\\%_]/g, '\\$&');
  return `%${escaped}%`;
}
