import {
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import {
  INQUIRY_SUBMIT_OPERATION,
  InquiryIdempotencyKey,
} from '../entities/inquiry-idempotency-key.entity';

export type InquirySubmitResult = {
  message: string;
  serviceSlug: string;
  targetId: number;
};

@Injectable()
export class InquiryIdempotencyService {
  private readonly logger = new Logger(InquiryIdempotencyService.name);

  constructor(
    @InjectRepository(InquiryIdempotencyKey)
    private readonly repository: Repository<InquiryIdempotencyKey>,
  ) {}

  hashSubmitRequest(
    dto: Record<string, unknown>,
    files: Array<{ originalname?: string; size?: number }>,
  ): string {
    const canonical = JSON.stringify({
      dto,
      files: files.map((file) => ({
        name: file.originalname ?? '',
        size: file.size ?? 0,
      })),
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Claim an idempotency key before creating the inquiry.
   * Returns a prior completed response when the same key+hash is retried.
   */
  async beginSubmit(
    userId: number,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<InquirySubmitResult | null> {
    const key = this.normalizeKey(idempotencyKey);
    const inserted: Array<{ id: string | number }> =
      await this.repository.manager.query(
        `INSERT INTO inquiry_idempotency_keys
           (user_id, operation, idempotency_key, request_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, operation, idempotency_key) DO NOTHING
         RETURNING id`,
        [userId, INQUIRY_SUBMIT_OPERATION, key, requestHash],
      );

    if (inserted.length > 0) {
      return null;
    }

    const existing = await this.repository.findOne({
      where: {
        userId,
        operation: INQUIRY_SUBMIT_OPERATION,
        idempotencyKey: key,
      },
    });
    if (!existing) {
      throw new ConflictException(
        'Idempotency key is already being processed. Please retry.',
      );
    }
    if (existing.responseJson) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency-Key was reused with a different request payload.',
        );
      }
      return existing.responseJson as InquirySubmitResult;
    }

    // Reclaim abandoned in-flight claims older than 10 minutes so a client
    // retry after a crash/timeout is not permanently blocked.
    const reclaimed: Array<{ id: string | number }> =
      await this.repository.manager.query(
        `UPDATE inquiry_idempotency_keys
         SET request_hash = $4,
             created_at = NOW(),
             completed_at = NULL,
             response_json = NULL,
             inquiry_id = NULL,
             service_slug = NULL
         WHERE user_id = $1
           AND operation = $2
           AND idempotency_key = $3
           AND response_json IS NULL
           AND created_at < NOW() - INTERVAL '10 minutes'
         RETURNING id`,
        [userId, INQUIRY_SUBMIT_OPERATION, key, requestHash],
      );
    if (reclaimed.length > 0) {
      return null;
    }

    if (existing.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key was reused with a different request payload.',
      );
    }
    throw new ConflictException(
      'Idempotency key is already being processed. Please retry.',
    );
  }

  async completeSubmit(
    userId: number,
    idempotencyKey: string,
    response: InquirySubmitResult,
  ): Promise<void> {
    const key = this.normalizeKey(idempotencyKey);
    await this.repository.manager.query(
      `UPDATE inquiry_idempotency_keys
       SET response_json = $4::jsonb,
           inquiry_id = $5,
           service_slug = $6,
           completed_at = NOW()
       WHERE user_id = $1
         AND operation = $2
         AND idempotency_key = $3`,
      [
        userId,
        INQUIRY_SUBMIT_OPERATION,
        key,
        JSON.stringify(response),
        response.targetId,
        response.serviceSlug,
      ],
    );
  }

  async abandonSubmit(userId: number, idempotencyKey: string): Promise<void> {
    const key = this.normalizeKey(idempotencyKey);
    try {
      await this.repository.manager.query(
        `DELETE FROM inquiry_idempotency_keys
         WHERE user_id = $1
           AND operation = $2
           AND idempotency_key = $3
           AND response_json IS NULL`,
        [userId, INQUIRY_SUBMIT_OPERATION, key],
      );
    } catch (error) {
      this.logger.warn(
        `Could not abandon idempotency key for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private normalizeKey(value: string): string {
    return value.trim().slice(0, 128);
  }
}
