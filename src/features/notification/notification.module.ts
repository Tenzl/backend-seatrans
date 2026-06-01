import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { NotificationSchemaBootstrap } from './notification.schema-bootstrap';
import { User } from '../auth/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, User])],
  providers: [NotificationService, NotificationSchemaBootstrap],
  controllers: [NotificationController],
  exports: [NotificationService],
})
export class NotificationModule {}
