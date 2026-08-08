import {
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JobQueueService } from '../../../shared/queue/queue.module';
import {
  BOOKING_PARTNER_IMPORT_COMMIT_JOB,
  BOOKING_PARTNER_IMPORT_PREVIEW_JOB,
  type BookingPartnerImportFilePayload,
  type JobRecord,
} from '../../../shared/queue/queue.types';
import {
  BookingPartnerImportService,
  type ImportCommitResult,
  type ImportPreviewResult,
} from './booking-partner-import.service';

export type ImportJobAccepted = {
  jobId: string;
  backend: string;
  statusUrlHint: string;
};

@Injectable()
export class BookingPartnerImportJobsService implements OnModuleInit {
  private readonly jobDir: string;

  constructor(
    private readonly importService: BookingPartnerImportService,
    private readonly jobs: JobQueueService,
    private readonly config: ConfigService,
  ) {
    this.jobDir = this.resolveJobDir();
  }

  onModuleInit(): void {
    this.jobs.registerHandler<
      BookingPartnerImportFilePayload,
      ImportPreviewResult
    >(BOOKING_PARTNER_IMPORT_PREVIEW_JOB, async (payload) => {
      try {
        const buffer = await this.readJobFile(payload.filePath);
        return await this.importService.preview(buffer);
      } finally {
        await this.safeUnlink(payload.filePath);
      }
    });

    this.jobs.registerHandler<
      BookingPartnerImportFilePayload,
      ImportCommitResult
    >(BOOKING_PARTNER_IMPORT_COMMIT_JOB, async (payload) => {
      try {
        const buffer = await this.readJobFile(payload.filePath);
        const actor = payload.actor?.trim() || 'system';
        return await this.importService.commit(buffer, actor);
      } finally {
        await this.safeUnlink(payload.filePath);
      }
    });
  }

  async enqueuePreview(buffer: Buffer): Promise<ImportJobAccepted> {
    this.requireQueue();
    this.requireSharedDirForBullMq();
    const filePath = await this.persistBuffer(buffer);
    try {
      const jobId = await this.jobs.enqueue(
        BOOKING_PARTNER_IMPORT_PREVIEW_JOB,
        { filePath } satisfies BookingPartnerImportFilePayload,
      );
      return this.accepted(jobId);
    } catch (error: unknown) {
      await this.safeUnlink(filePath);
      throw this.mapEnqueueError(error);
    }
  }

  async enqueueCommit(
    buffer: Buffer,
    actor: string,
  ): Promise<ImportJobAccepted> {
    this.requireQueue();
    this.requireSharedDirForBullMq();
    const filePath = await this.persistBuffer(buffer);
    try {
      const jobId = await this.jobs.enqueue(
        BOOKING_PARTNER_IMPORT_COMMIT_JOB,
        {
          filePath,
          actor,
        } satisfies BookingPartnerImportFilePayload,
      );
      return this.accepted(jobId);
    } catch (error: unknown) {
      await this.safeUnlink(filePath);
      throw this.mapEnqueueError(error);
    }
  }

  async getJob(
    jobId: string,
  ): Promise<JobRecord<ImportPreviewResult | ImportCommitResult>> {
    this.requireQueue();
    const normalized = jobId?.trim();
    if (!normalized) {
      throw new BadRequestException('jobId is required');
    }
    const job = await this.jobs.getJob<ImportPreviewResult | ImportCommitResult>(
      normalized,
    );
    if (!job) {
      if (this.jobs.backend === 'in-process') {
        throw new NotFoundException(
          'Import job not found on this process. In-process queue status is local to the replica that accepted the job; retry against that replica or enable REDIS_URL + BullMQ.',
        );
      }
      throw new NotFoundException('Import job not found');
    }
    return job;
  }

  private requireQueue(): void {
    if (!this.jobs.isEnabled()) {
      throw new ServiceUnavailableException(
        'Background queue is disabled. Set QUEUE_ENABLED=true (optional REDIS_URL for BullMQ) or use the sync import endpoints.',
      );
    }
  }

  /**
   * BullMQ workers may run on another replica. Local APP_UPLOAD_DIR paths are
   * not visible across hosts — require an explicit shared volume root.
   */
  private requireSharedDirForBullMq(): void {
    if (this.jobs.backend !== 'bullmq') return;
    const shared = this.config.get<string>('IMPORT_JOB_SHARED_DIR')?.trim();
    if (shared) return;
    throw new ServiceUnavailableException(
      'BullMQ async import requires IMPORT_JOB_SHARED_DIR (shared volume mounted on every API/worker replica). Use the sync import endpoints, or set IMPORT_JOB_SHARED_DIR and QUEUE_ENABLED=true with REDIS_URL.',
    );
  }

  private resolveJobDir(): string {
    const shared = this.config.get<string>('IMPORT_JOB_SHARED_DIR')?.trim();
    if (shared) {
      return resolve(shared);
    }
    const uploadRoot =
      this.config.get<string>('APP_UPLOAD_DIR')?.trim() || './uploads';
    return resolve(join(uploadRoot, 'queue-jobs'));
  }

  private accepted(jobId: string): ImportJobAccepted {
    return {
      jobId,
      backend: this.jobs.backend,
      statusUrlHint: `GET /api/v1/admin/booking-management/partners/import/jobs/${jobId}`,
    };
  }

  private async persistBuffer(buffer: Buffer): Promise<string> {
    await mkdir(this.jobDir, { recursive: true });
    const filePath = join(this.jobDir, `${randomUUID()}.bin`);
    await writeFile(filePath, buffer);
    return filePath;
  }

  private async readJobFile(filePath: string): Promise<Buffer> {
    const resolved = this.assertPathInsideJobDir(filePath);
    return readFile(resolved);
  }

  private assertPathInsideJobDir(filePath: string): string {
    const candidate = isAbsolute(filePath)
      ? normalize(filePath)
      : resolve(this.jobDir, filePath);
    const rel = relative(this.jobDir, candidate);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new BadRequestException('Invalid import job file path');
    }
    return candidate;
  }

  private async safeUnlink(filePath: string): Promise<void> {
    try {
      const resolved = this.assertPathInsideJobDir(filePath);
      await unlink(resolved);
    } catch {
      // Best-effort cleanup (also swallows path-guard failures).
    }
  }

  private mapEnqueueError(error: unknown): Error {
    const message = error instanceof Error ? error.message : 'Enqueue failed';
    if (/full|QUEUE_ENABLED|IMPORT_JOB_SHARED_DIR/i.test(message)) {
      return new ServiceUnavailableException(message);
    }
    return error instanceof Error ? error : new Error(message);
  }
}
