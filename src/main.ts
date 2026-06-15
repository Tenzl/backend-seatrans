import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { GlobalExceptionFilter } from './shared/filters/global-exception.filter';
import { ResponseInterceptor } from './shared/interceptors/response.interceptor';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS
  const rawOrigins = process.env.CORS_ORIGINS ?? 'http://localhost:3000';
  const origins = rawOrigins
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Set global prefix mapping to existing Java routes
  app.setGlobalPrefix('api');

  // Enable cookie parsing for HttpOnly auth cookies
  app.use(cookieParser());

  // Security headers (CSP is typically handled at the edge / Next.js)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // Cloudinary, etc.
    }),
  );

  // Automatically validate Data Transfer Objects
  app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      transform: true,
  }));

  // Bind global exception filter mirroring Java's GlobalExceptionHandler
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Wrap responses in ApiResponse payload mirroring Java's ApiResponse wrapper
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Render (and most PaaS) inject the port to bind on via PORT; fall back to
  // SERVER_PORT for local dev. Bind 0.0.0.0 so the platform can detect the port.
  const port = process.env.PORT ?? process.env.SERVER_PORT ?? 8080;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on port ${port}`);
}
bootstrap();
