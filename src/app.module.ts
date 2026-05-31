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
import { UsersModule } from './features/users/users.module';
import { NotificationModule } from './features/notification/notification.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
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
    ProvincesModule,
    PortsModule,
    CommoditiesModule,
    GalleryModule,
    LogisticsModule,
    PostModule,
    BookingModule,
    InquiryModule,
    UsersModule,
    NotificationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
