import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import {
  AdminAuditLog,
  AdminAuditStatus,
} from './entities/admin-audit-log.entity';

export interface BeginAdminAuditInput {
  actorUserId: number;
  details?: Record<string, unknown> | null;
  method: string;
  requestPath: string;
  resourceId: string | null;
  resourceType: string;
}

@Injectable()
export class AdminAuditService {
  constructor(
    @InjectRepository(AdminAuditLog)
    private readonly repository: Repository<AdminAuditLog>,
  ) {}

  async begin(input: BeginAdminAuditInput): Promise<{ id: number }> {
    const saved = await this.repository.save(
      this.repository.create({
        requestId: randomUUID(),
        actorUserId: input.actorUserId,
        action: 'PERMANENT_DELETE',
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        method: input.method,
        requestPath: input.requestPath,
        status: AdminAuditStatus.STARTED,
        details: input.details ?? null,
        completedAt: null,
      }),
    );
    return { id: saved.id };
  }

  async succeed(
    id: number,
    details: Record<string, unknown> | null,
  ): Promise<void> {
    await this.finalize(id, AdminAuditStatus.SUCCEEDED, details);
  }

  async fail(id: number, details: Record<string, unknown>): Promise<void> {
    await this.finalize(id, AdminAuditStatus.FAILED, details);
  }

  private async finalize(
    id: number,
    status: AdminAuditStatus,
    details: Record<string, unknown> | null,
  ): Promise<void> {
    const audit = await this.repository.findOneBy({ id });
    if (!audit) {
      throw new Error(`Admin audit log ${id} was not found`);
    }

    audit.status = status;
    audit.details = this.mergeDetails(audit.details, details);
    audit.completedAt = new Date();
    await this.repository.save(audit);
  }

  private mergeDetails(
    existing: Record<string, unknown> | null,
    next: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (!existing && !next) return null;
    return { ...(existing ?? {}), ...(next ?? {}) };
  }
}
