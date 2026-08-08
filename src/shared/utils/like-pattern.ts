/**
 * Build a case-insensitive SQL LIKE pattern that matches anywhere while
 * treating user-entered wildcard characters as literal text.
 */
export function buildContainsLikePattern(value: string): string {
  const normalized = value.trim().toLowerCase();
  const escaped = normalized.replace(/[\\%_]/g, '\\$&');
  return `%${escaped}%`;
}
