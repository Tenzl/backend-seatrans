import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export type DatabaseSslConfig = {
  rejectUnauthorized: boolean;
  ca?: string;
};

export type DatabaseSslInput = {
  sslMode?: string | null;
  enabled?: string | null;
  rejectUnauthorized?: string | null;
  caPath?: string | null;
  baseDirectory?: string;
};

const truthy = (value?: string | null): boolean =>
  ['true', '1', 'require'].includes(value?.trim().toLowerCase() ?? '');

/**
 * Resolve the pg TLS options shared by application and migration connections.
 * URL modes `verify-ca` and `verify-full` are strict and cannot be weakened by
 * DB_SSL_REJECT_UNAUTHORIZED=false. `require` is encryption-only unless a CA
 * or explicit rejectUnauthorized=true is configured.
 */
export function resolveDatabaseSsl(
  input: DatabaseSslInput,
): DatabaseSslConfig | undefined {
  const sslMode = input.sslMode?.trim().toLowerCase() ?? null;
  const strictVerification =
    sslMode === 'verify-ca' || sslMode === 'verify-full';
  const enabled =
    strictVerification || sslMode === 'require' || truthy(input.enabled);
  if (!enabled) return undefined;

  const caPath = input.caPath?.trim();
  if (caPath) {
    const absolute = isAbsolute(caPath)
      ? caPath
      : resolve(input.baseDirectory ?? process.cwd(), caPath);
    if (!existsSync(absolute)) {
      throw new Error(`DB_SSL_CA_PATH not found at ${absolute}`);
    }
    return {
      rejectUnauthorized: true,
      ca: readFileSync(absolute, 'utf8'),
    };
  }

  return {
    rejectUnauthorized: strictVerification || truthy(input.rejectUnauthorized),
  };
}
