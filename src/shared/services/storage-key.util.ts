/**
 * Path helpers for S3/R2 object keys (POSIX-style, no leading slash).
 */

const INVALID_SEGMENT = /(?:^|\/)\.\.(?:\/|$)/;

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

export function normalizePrefix(prefix?: string | null): string {
  const trimmed = String(prefix ?? '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  return trimmed ? `${trimmed}/` : '';
}

export function parentPrefixOf(prefix: string): string | null {
  const normalized = normalizePrefix(prefix);
  if (!normalized) return null;
  const withoutTrailing = normalized.slice(0, -1);
  const idx = withoutTrailing.lastIndexOf('/');
  if (idx < 0) return '';
  return withoutTrailing.slice(0, idx + 1);
}

export function basename(key: string): string {
  const normalized = key.replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  return idx < 0 ? normalized : normalized.slice(idx + 1);
}

export function joinKey(prefix: string, name: string): string {
  const base = normalizePrefix(prefix);
  const child = String(name).replace(/^\/+/, '').replace(/\/+$/, '');
  assertSafeKeySegment(child, 'name');
  return base ? `${base}${child}` : child;
}

export function folderKey(prefix: string, folderName: string): string {
  const key = joinKey(prefix, folderName);
  return key.endsWith('/') ? key : `${key}/`;
}

export function assertSafeKey(key: string, label = 'key'): void {
  const value = String(key ?? '').trim();
  if (!value) {
    throw new Error(`${label} is required`);
  }
  if (value.startsWith('/')) {
    throw new Error(`${label} must not start with /`);
  }
  if (INVALID_SEGMENT.test(value) || value.includes('..')) {
    throw new Error(`${label} contains invalid path segments`);
  }
  if (containsControlCharacter(value)) {
    throw new Error(`${label} contains invalid characters`);
  }
  if (value.length > 1024) {
    throw new Error(`${label} is too long`);
  }
}

export function assertSafeKeySegment(segment: string, label = 'name'): void {
  const value = String(segment ?? '').trim();
  if (!value) {
    throw new Error(`${label} is required`);
  }
  if (value.includes('/') || value.includes('\\')) {
    throw new Error(`${label} must not contain slashes`);
  }
  if (value === '.' || value === '..') {
    throw new Error(`${label} is invalid`);
  }
  assertSafeKey(value, label);
}

export function isFolderKey(key: string): boolean {
  return key.endsWith('/');
}
