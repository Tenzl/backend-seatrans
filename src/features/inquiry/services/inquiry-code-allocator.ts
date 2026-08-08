import { Injectable } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';

/**
 * Shared inquiry-code allocation for public submissions and internal EPDA creates.
 * Lock key and sequence algorithm must stay identical across callers so SA codes
 * cannot race between ServiceInquiryService and ShippingAgencyEpdaService.
 */
@Injectable()
export class InquiryCodeAllocator {
  lockKey(prefix: string): string {
    return `inquiry-code:${prefix}`;
  }

  async acquireLock(manager: EntityManager, prefix: string): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      this.lockKey(prefix),
    ]);
  }

  /**
   * Next code for `prefix` (e.g. `SA-2026-`). Caller must hold the advisory lock
   * for that prefix on the same connection.
   */
  async nextCode(
    repository: Repository<{ code: string | null }>,
    prefix: string,
  ): Promise<string> {
    const last = await repository
      .createQueryBuilder('inquiry')
      .select(
        'MAX(CAST(SUBSTRING(inquiry.code FROM CHAR_LENGTH(:codePrefix) + 1) AS BIGINT))',
        'lastNumber',
      )
      .where(
        "inquiry.code LIKE :prefixPattern AND SUBSTRING(inquiry.code FROM CHAR_LENGTH(:codePrefix) + 1) ~ '^[0-9]+$'",
        {
          codePrefix: prefix,
          prefixPattern: `${prefix}%`,
        },
      )
      .getRawOne<{ lastNumber: string | null }>();

    // BigInt avoids rollover/precision bugs when the sequence grows beyond
    // four digits; padStart preserves the existing display format.
    const nextNumber = BigInt(last?.lastNumber ?? '0') + 1n;

    return `${prefix}${String(nextNumber).padStart(4, '0')}`;
  }

  async allocate(
    manager: EntityManager,
    repository: Repository<{ code: string | null }>,
    prefix: string,
  ): Promise<string> {
    await this.acquireLock(manager, prefix);
    return this.nextCode(repository, prefix);
  }
}
