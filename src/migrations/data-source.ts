import 'reflect-metadata';
import { join } from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { resolveDatabaseSsl } from '../shared/database/database-ssl';

function databaseOptions(): DataSourceOptions {
  const common = {
    type: 'postgres' as const,
    entities: [join(__dirname, '../features/**/*.entity.js')],
    migrations: [join(__dirname, '[0-9]*-*.js')],
    synchronize: false,
  };
  const dbUrl = process.env.DB_URL?.trim();
  if (dbUrl) {
    const parsedUrl = new URL(dbUrl);
    const ssl = resolveDatabaseSsl({
      sslMode: parsedUrl.searchParams.get('sslmode'),
      enabled: process.env.DB_SSL,
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED,
      caPath: process.env.DB_SSL_CA_PATH,
    });
    return {
      ...common,
      host: parsedUrl.hostname,
      port: Number(parsedUrl.port) || 5432,
      username: decodeURIComponent(parsedUrl.username),
      password: decodeURIComponent(parsedUrl.password),
      database: parsedUrl.pathname.replace(/^\//, ''),
      ssl,
      extra: ssl ? { ssl } : undefined,
    };
  }

  const ssl = resolveDatabaseSsl({
    enabled: process.env.DB_SSL,
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED,
    caPath: process.env.DB_SSL_CA_PATH,
  });
  return {
    ...common,
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_DATABASE ?? 'seatrans',
    ssl,
    extra: ssl ? { ssl } : undefined,
  };
}

export default new DataSource(databaseOptions());
