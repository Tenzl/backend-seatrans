import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { resolveDatabaseSsl, type DatabaseSslConfig } from './database-ssl';
import { readPositiveInt } from '../utils/env-int';

function requiredProductionValue(
  configService: ConfigService,
  key: string,
  fallback: string,
): string {
  const value = configService.get<string>(key)?.trim();
  if (value) return value;
  if (configService.get<string>('NODE_ENV') === 'production') {
    throw new Error(`${key} is required in production`);
  }
  return fallback;
}

function databasePort(configService: ConfigService): number {
  const raw = configService.get<string>('DB_PORT')?.trim();
  if (!raw) {
    if (configService.get<string>('NODE_ENV') === 'production') {
      throw new Error('DB_PORT is required in production');
    }
    return 5432;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('DB_PORT must be an integer between 1 and 65535');
  }
  return port;
}

/** Defaults sized for a single Nest replica talking to shared Postgres. */
export const DB_POOL_DEFAULTS = {
  max: 10,
  connectionTimeoutMillis: 5_000,
  statementTimeoutMs: 30_000,
  lockTimeoutMs: 10_000,
} as const;

export function resolvePoolSettings(configService: ConfigService): {
  max: number;
  connectionTimeoutMillis: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
} {
  return {
    max: readPositiveInt(
      configService.get<string>('DB_POOL_MAX'),
      DB_POOL_DEFAULTS.max,
      { min: 1, max: 100 },
    ),
    connectionTimeoutMillis: readPositiveInt(
      configService.get<string>('DB_POOL_CONNECTION_TIMEOUT_MS'),
      DB_POOL_DEFAULTS.connectionTimeoutMillis,
      { min: 500, max: 60_000 },
    ),
    statementTimeoutMs: readPositiveInt(
      configService.get<string>('DB_STATEMENT_TIMEOUT_MS'),
      DB_POOL_DEFAULTS.statementTimeoutMs,
      { min: 1_000, max: 300_000 },
    ),
    lockTimeoutMs: readPositiveInt(
      configService.get<string>('DB_LOCK_TIMEOUT_MS'),
      DB_POOL_DEFAULTS.lockTimeoutMs,
      { min: 500, max: 120_000 },
    ),
  };
}

function buildPgExtra(
  configService: ConfigService,
  ssl: DatabaseSslConfig | undefined,
): Record<string, unknown> {
  const pool = resolvePoolSettings(configService);
  return {
    max: pool.max,
    connectionTimeoutMillis: pool.connectionTimeoutMillis,
    // Applied on each new connection via libpq `options`.
    options: `-c statement_timeout=${pool.statementTimeoutMs} -c lock_timeout=${pool.lockTimeoutMs}`,
    ...(ssl ? { ssl } : {}),
  };
}

export function buildDatabaseOptions(
  configService: ConfigService,
  logger = new Logger('DatabaseModule'),
): TypeOrmModuleOptions {
  // Production schema changes are owned by explicit migration runners.
  const synchronize = false;
  const migrationsRun = false;
  const dbUrl = configService.get<string>('DB_URL')?.trim();
  const pool = resolvePoolSettings(configService);

  if (dbUrl) {
    const parsedUrl = new URL(dbUrl);
    if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
      throw new Error('DB_URL must use the postgres or postgresql protocol');
    }
    const hostname = parsedUrl.hostname;
    const username = decodeURIComponent(parsedUrl.username);
    const password = decodeURIComponent(parsedUrl.password);
    const database = parsedUrl.pathname.replace(/^\/+/, '');
    if (!hostname || !username || !password || !database) {
      throw new Error(
        'DB_URL must include host, username, password, and database',
      );
    }
    const port = parsedUrl.port ? Number(parsedUrl.port) : 5432;
    const sslMode = parsedUrl.searchParams.get('sslmode');
    const ssl = resolveDatabaseSsl({
      sslMode,
      enabled: configService.get<string>('DB_SSL'),
      rejectUnauthorized: configService.get<string>(
        'DB_SSL_REJECT_UNAUTHORIZED',
      ),
      caPath: configService.get<string>('DB_SSL_CA_PATH'),
    });
    logger.log(
      `Database connection configured: source=DB_URL host=${hostname} port=${port} database=${database} ssl=${ssl ? 'on' : 'off'} poolMax=${pool.max} acquireTimeoutMs=${pool.connectionTimeoutMillis} statementTimeoutMs=${pool.statementTimeoutMs} lockTimeoutMs=${pool.lockTimeoutMs}`,
    );
    return {
      type: 'postgres',
      host: hostname,
      port,
      username,
      password,
      database,
      autoLoadEntities: true,
      entities: [],
      migrations: [],
      synchronize,
      migrationsRun,
      ssl,
      extra: buildPgExtra(configService, ssl),
    };
  }

  const host = requiredProductionValue(configService, 'DB_HOST', 'localhost');
  const port = databasePort(configService);
  const username = requiredProductionValue(
    configService,
    'DB_USERNAME',
    'postgres',
  );
  const password = requiredProductionValue(
    configService,
    'DB_PASSWORD',
    'postgres',
  );
  const database = requiredProductionValue(
    configService,
    'DB_DATABASE',
    'seatrans',
  );
  const ssl = resolveDatabaseSsl({
    enabled: configService.get<string>('DB_SSL'),
    rejectUnauthorized: configService.get<string>('DB_SSL_REJECT_UNAUTHORIZED'),
    caPath: configService.get<string>('DB_SSL_CA_PATH'),
  });
  logger.log(
    `Database connection configured: source=environment host=${host} port=${port} database=${database} ssl=${ssl ? 'on' : 'off'} poolMax=${pool.max} acquireTimeoutMs=${pool.connectionTimeoutMillis} statementTimeoutMs=${pool.statementTimeoutMs} lockTimeoutMs=${pool.lockTimeoutMs}`,
  );

  return {
    type: 'postgres',
    host,
    port,
    username,
    password,
    database,
    autoLoadEntities: true,
    entities: [],
    migrations: [],
    synchronize,
    migrationsRun,
    ssl,
    extra: buildPgExtra(configService, ssl),
  };
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: buildDatabaseOptions,
    }),
  ],
})
export class DatabaseModule {}
