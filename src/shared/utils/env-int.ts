/** Parse a positive int env var; return `fallback` when missing/invalid. */
export function readPositiveInt(
  raw: string | undefined,
  fallback: number,
  options?: { min?: number; max?: number },
): number {
  const min = options?.min ?? 1;
  const max = options?.max ?? Number.MAX_SAFE_INTEGER;
  if (raw == null || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    return fallback;
  }
  return Math.min(value, max);
}
