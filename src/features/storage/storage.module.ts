import { Module } from '@nestjs/common';
import { StorageAdminController } from './storage-admin.controller';
import { StorageService } from './storage.service';
import { R2StorageService } from '../../shared/services/r2-storage.service';

@Module({
  providers: [StorageService, R2StorageService],
  controllers: [StorageAdminController],
})
export class StorageModule {}
