import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

type SslConfig = boolean | { rejectUnauthorized: boolean; ca?: string };

function buildSsl(
  configService: ConfigService,
  sslModeFromUrl?: string | null,
): SslConfig | undefined {
  const explicit = configService.get<string>('DB_SSL')?.toLowerCase();
  const requireFromUrl =
    sslModeFromUrl && ['require', 'verify-ca', 'verify-full'].includes(sslModeFromUrl);

  const sslEnabled =
    explicit === 'true' || explicit === '1' || explicit === 'require' || Boolean(requireFromUrl);

  if (!sslEnabled) return undefined;

  const rejectRaw = configService
    .get<string>('DB_SSL_REJECT_UNAUTHORIZED', 'false')
    .toLowerCase();
  const rejectUnauthorized = rejectRaw === 'true' || rejectRaw === '1';

  const caPath = configService.get<string>('DB_SSL_CA_PATH')?.trim();
  if (caPath) {
    const absolute = path.isAbsolute(caPath) ? caPath : path.resolve(process.cwd(), caPath);
    if (fs.existsSync(absolute)) {
      return { rejectUnauthorized: true, ca: fs.readFileSync(absolute, 'utf8') };
    }
    // eslint-disable-next-line no-console
    console.warn(`[Database] DB_SSL_CA_PATH not found at ${absolute}, falling back to rejectUnauthorized=${rejectUnauthorized}`);
  }

  return { rejectUnauthorized };
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const entities = [__dirname + '/../../**/*.entity{.ts,.js}'];
        const synchronize = true; // Use with caution. Do not use in production.

        const dbUrl = configService.get<string>('DB_URL')?.trim();
        if (dbUrl) {
          const parsedUrl = new URL(dbUrl);
          const sslMode = parsedUrl.searchParams.get('sslmode');
          const ssl = buildSsl(configService, sslMode);
          // eslint-disable-next-line no-console
          console.log(
            `[Database] Using DB_URL -> host=${parsedUrl.hostname} port=${Number(parsedUrl.port) || 5432} user=${parsedUrl.username} db=${parsedUrl.pathname.replace('/', '')} ssl=${ssl ? 'on' : 'off'}`,
          );
          return {
            type: 'postgres',
            host: parsedUrl.hostname,
            port: Number(parsedUrl.port) || 5432,
            username: decodeURIComponent(parsedUrl.username),
            password: String(decodeURIComponent(parsedUrl.password)), // Fix lỗi SASL SCRAM-SERVER-FIRST-MESSAGE
            database: parsedUrl.pathname.replace('/', ''),
            entities,
            synchronize,
            ssl,
            extra: ssl ? { ssl } : undefined,
          };
        }

        const host = configService.get<string>('DB_HOST', 'localhost');
        const port = Number(configService.get<string>('DB_PORT', '5432')) || 5432;
        const username = configService.get<string>('DB_USERNAME', 'postgres');
        const database = configService.get<string>('DB_DATABASE', 'seatrans');
        const ssl = buildSsl(configService);
        // eslint-disable-next-line no-console
        console.log(
          `[Database] Using fallback env -> host=${host} port=${port} user=${username} db=${database} ssl=${ssl ? 'on' : 'off'}`,
        );

        return {
          type: 'postgres',
          host,
          port,
          username,
          password: String(configService.get<string>('DB_PASSWORD', 'postgres')),
          database,
          entities,
          synchronize,
          ssl,
          extra: ssl ? { ssl } : undefined,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
