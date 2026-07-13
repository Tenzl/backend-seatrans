import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { resolveDatabaseSsl } from './database-ssl';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // Prefer Nest autoLoadEntities over a recursive entities/migrations glob.
        // TypeORM's DirectoryExportedClassesLoader can hit "Maximum call stack
        // size exceeded" when walking circular CommonJS exports from **/*.entity.
        // Run migrations via CLI (`npm run db:migration:run`), not at app boot.
        const synchronize =
          configService.get<string>('DB_SYNCHRONIZE', 'false').toLowerCase() ===
          'true';
        const migrationsRun = false;

        const dbUrl = configService.get<string>('DB_URL')?.trim();
        if (dbUrl) {
          const parsedUrl = new URL(dbUrl);
          const sslMode = parsedUrl.searchParams.get('sslmode');
          const ssl = resolveDatabaseSsl({
            sslMode,
            enabled: configService.get<string>('DB_SSL'),
            rejectUnauthorized: configService.get<string>(
              'DB_SSL_REJECT_UNAUTHORIZED',
            ),
            caPath: configService.get<string>('DB_SSL_CA_PATH'),
          });
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
            autoLoadEntities: true,
            entities: [],
            migrations: [],
            synchronize,
            migrationsRun,
            ssl,
            extra: ssl ? { ssl } : undefined,
          };
        }

        const host = configService.get<string>('DB_HOST', 'localhost');
        const port =
          Number(configService.get<string>('DB_PORT', '5432')) || 5432;
        const username = configService.get<string>('DB_USERNAME', 'postgres');
        const database = configService.get<string>('DB_DATABASE', 'seatrans');
        const ssl = resolveDatabaseSsl({
          enabled: configService.get<string>('DB_SSL'),
          rejectUnauthorized: configService.get<string>(
            'DB_SSL_REJECT_UNAUTHORIZED',
          ),
          caPath: configService.get<string>('DB_SSL_CA_PATH'),
        });
        console.log(
          `[Database] Using fallback env -> host=${host} port=${port} user=${username} db=${database} ssl=${ssl ? 'on' : 'off'}`,
        );

        return {
          type: 'postgres',
          host,
          port,
          username,
          password: String(
            configService.get<string>('DB_PASSWORD', 'postgres'),
          ),
          database,
          autoLoadEntities: true,
          entities: [],
          migrations: [],
          synchronize,
          migrationsRun,
          ssl,
          extra: ssl ? { ssl } : undefined,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
