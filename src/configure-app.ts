import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { resolveCorsOrigins } from './config/environment';
import { createGlobalValidationPipe } from './config/global-validation';
import { GlobalExceptionFilter } from './shared/filters/global-exception.filter';
import { ResponseInterceptor } from './shared/interceptors/response.interceptor';

/** Apply the same HTTP contract in production bootstrap and end-to-end tests. */
export function configureApplication(
  app: INestApplication,
  configService: ConfigService,
): void {
  const origins = resolveCorsOrigins({
    NODE_ENV: configService.get<string>('NODE_ENV'),
    CORS_ORIGINS: configService.get<string>('CORS_ORIGINS'),
  });

  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
}
