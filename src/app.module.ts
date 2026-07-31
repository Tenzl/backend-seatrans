import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './features/auth/auth.module';
import { DatabaseModule } from './shared/database/database.module';
import { ProvincesModule } from './features/provinces/provinces.module';
import { PortsModule } from './features/ports/ports.module';
import { CommoditiesModule } from './features/commodities/commodities.module';
import { GalleryModule } from './features/gallery/gallery.module';
import { LogisticsModule } from './features/logistics/logistics.module';
import { PostModule } from './features/post/post.module';
import { BookingModule } from './features/booking/booking.module';
import { InquiryModule } from './features/inquiry/inquiry.module';
import { EpdaParametersModule } from './features/epda-parameters/epda-parameters.module';
import { UsersModule } from './features/users/users.module';
import { NotificationModule } from './features/notification/notification.module';
import { RolesModule } from './features/roles/roles.module';
import { StorageModule } from './features/storage/storage.module';
import { BookingDocumentsModule } from './features/booking-documents/booking-documents.module';
import { AuditModule } from './shared/audit/audit.module';
import { HealthModule } from './shared/health/health.module';
import { validateEnvironment } from './config/environment';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      cache: true,
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60_000,
          limit: 120,
        },
      ],
    }),
    AuthModule,
    DatabaseModule,
    AuditModule,
    ProvincesModule,
    PortsModule,
    CommoditiesModule,
    GalleryModule,
    LogisticsModule,
    PostModule,
    BookingModule,
    InquiryModule,
    EpdaParametersModule,
    UsersModule,
    NotificationModule,
    RolesModule,
    StorageModule,
    BookingDocumentsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
