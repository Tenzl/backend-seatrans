import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuditService } from './admin-audit.service';
import { DestructiveActionAuditInterceptor } from './destructive-action-audit.interceptor';
import { AdminAuditLog } from './entities/admin-audit-log.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AdminAuditLog])],
  providers: [AdminAuditService, DestructiveActionAuditInterceptor],
  exports: [AdminAuditService, DestructiveActionAuditInterceptor],
})
export class AuditModule {}
