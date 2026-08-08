import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { resolveCorsOrigins, resolveTrustProxy } from './config/environment';
import { createGlobalValidationPipe } from './config/global-validation';
import { GlobalExceptionFilter } from './shared/filters/global-exception.filter';
import { ResponseInterceptor } from './shared/interceptors/response.interceptor';
import { createCsrfOriginMiddleware } from './shared/security/csrf-origin';

/** Apply the same HTTP contract in production bootstrap and end-to-end tests. */
export function configureApplication(
  app: INestApplication,
  configService: ConfigService,
): void {
  const envInput = {
    NODE_ENV: configService.get<string>('NODE_ENV'),
    CORS_ORIGINS: configService.get<string>('CORS_ORIGINS'),
    TRUST_PROXY: configService.get<string>('TRUST_PROXY'),
  };
  const origins = resolveCorsOrigins(envInput);
  const trustProxyHops = resolveTrustProxy(envInput);

  // Only trust XFF / CF-Connecting-IP when behind a known proxy (see TRUST_PROXY).
  // Leaving this off keeps req.ip = direct socket address so login throttle
  // cannot be bypassed by forging forwarding headers against the origin.
  // Use the underlying Express instance — INestApplication has no `.set()`.
  if (trustProxyHops !== false) {
    const http = app.getHttpAdapter().getInstance() as {
      set?: (key: string, value: unknown) => void;
    };
    http.set?.('trust proxy', trustProxyHops);
  }

  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // Credentials + SameSite=Lax cookies: browser sends Origin automatically.
    // No CSRF token header required for dashboard_admin / frontend BFF clients.
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  // SEC-05: Origin/Referer check for cookie credential mutations (after cookies parse).
  app.use(createCsrfOriginMiddleware(origins));
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // Reinforce nosniff for API responses (download handlers also set this).
      noSniff: true,
    }),
  );
  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
}
