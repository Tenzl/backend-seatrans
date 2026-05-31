import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { NotificationSchemaBootstrap } from './notification.schema-bootstrap';

@Module({
  imports: [TypeOrmModule.forFeature([Notification])],
  providers: [NotificationService, NotificationSchemaBootstrap],
  controllers: [NotificationController],
  exports: [NotificationService],
})
export class NotificationModule {}
