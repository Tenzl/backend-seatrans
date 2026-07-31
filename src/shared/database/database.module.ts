import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { resolveDatabaseSsl } from './database-ssl';

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

export function buildDatabaseOptions(
  configService: ConfigService,
  logger = new Logger('DatabaseModule'),
): TypeOrmModuleOptions {
  // Production schema changes are owned by explicit migration runners.
  const synchronize = false;
  const migrationsRun = false;
  const dbUrl = configService.get<string>('DB_URL')?.trim();

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
      `Database connection configured: source=DB_URL host=${hostname} port=${port} database=${database} ssl=${ssl ? 'on' : 'off'}`,
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
      extra: ssl ? { ssl } : undefined,
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
    `Database connection configured: source=environment host=${host} port=${port} database=${database} ssl=${ssl ? 'on' : 'off'}`,
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
    extra: ssl ? { ssl } : undefined,
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
