import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { GlobalExceptionFilter } from './shared/filters/global-exception.filter';
import { ResponseInterceptor } from './shared/interceptors/response.interceptor';

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

  // Automatically validate Data Transfer Objects
  app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      transform: true,
  }));

  // Bind global exception filter mirroring Java's GlobalExceptionHandler
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Wrap responses in ApiResponse payload mirroring Java's ApiResponse wrapper
  app.useGlobalInterceptors(new ResponseInterceptor());

  const port = process.env.SERVER_PORT ?? 8080;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
