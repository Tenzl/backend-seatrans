import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { safeErrorForLog } from './shared/logging/safe-error-log';
import { configureApplication } from './configure-app';

async function bootstrap() {
  let app: INestApplication | undefined;
  try {
    app = await NestFactory.create(AppModule, { bufferLogs: true });
    const configService = app.get(ConfigService);
    app.useLogger(new Logger());
    configureApplication(app, configService);

    const port = configService.getOrThrow<number>('PORT');
    await app.listen(port, '0.0.0.0');
    Logger.log(`Application is running on port ${port}`, 'Bootstrap');
  } catch (error) {
    if (app) {
      await app.close().catch(() => undefined);
    }
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  const safeError = safeErrorForLog(error);
  Logger.error(safeError.message, safeError.stack, 'Bootstrap');
  process.exitCode = 1;
});
