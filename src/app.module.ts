import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
