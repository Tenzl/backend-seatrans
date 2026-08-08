import { ConflictException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import {
  InquiryIdempotencyService,
  type InquirySubmitResult,
} from './inquiry-idempotency.service';
import { InquiryIdempotencyKey } from '../entities/inquiry-idempotency-key.entity';

describe('InquiryIdempotencyService', () => {
  const manager = { query: jest.fn() };
  const repository = {
    manager,
    findOne: jest.fn(),
  };

  let service: InquiryIdempotencyService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InquiryIdempotencyService(
      repository as unknown as Repository<InquiryIdempotencyKey>,
    );
  });

  it('hashes request payload and file metadata stably', () => {
    const a = service.hashSubmitRequest({ serviceTypeId: 1 }, [
      { originalname: 'a.pdf', size: 10 },
    ]);
    const b = service.hashSubmitRequest({ serviceTypeId: 1 }, [
      { originalname: 'a.pdf', size: 10 },
    ]);
    const c = service.hashSubmitRequest({ serviceTypeId: 2 }, [
      { originalname: 'a.pdf', size: 10 },
    ]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64);
  });

  it('returns null when the key is newly claimed', async () => {
    manager.query.mockResolvedValueOnce([{ id: 1 }]);

    await expect(
      service.beginSubmit(42, 'key-1', 'hash-1'),
    ).resolves.toBeNull();
  });

  it('returns the prior response for a completed same-hash retry', async () => {
    const prior: InquirySubmitResult = {
      message: 'ok',
      serviceSlug: 'shipping-agency',
      targetId: 9,
    };
    manager.query.mockResolvedValueOnce([]);
    repository.findOne.mockResolvedValueOnce({
      requestHash: 'hash-1',
      responseJson: prior,
    });

    await expect(
      service.beginSubmit(42, 'key-1', 'hash-1'),
    ).resolves.toEqual(prior);
  });

  it('conflicts when the same key is reused with a different payload hash', async () => {
    manager.query.mockResolvedValueOnce([]);
    repository.findOne.mockResolvedValueOnce({
      requestHash: 'hash-old',
      responseJson: { message: 'done', serviceSlug: 'shipping-agency', targetId: 1 },
    });

    await expect(
      service.beginSubmit(42, 'key-1', 'hash-new'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('conflicts while a fresh in-flight claim with a different hash is active', async () => {
    manager.query
      .mockResolvedValueOnce([]) // INSERT conflict
      .mockResolvedValueOnce([]); // reclaim misses (still fresh)
    repository.findOne.mockResolvedValueOnce({
      requestHash: 'hash-old',
      responseJson: null,
    });

    await expect(
      service.beginSubmit(42, 'key-1', 'hash-new'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reclaims a stale in-flight key older than 10 minutes', async () => {
    manager.query
      .mockResolvedValueOnce([]) // INSERT conflict
      .mockResolvedValueOnce([{ id: 9 }]); // reclaim UPDATE
    repository.findOne.mockResolvedValueOnce({
      requestHash: 'hash-old',
      responseJson: null,
    });

    await expect(
      service.beginSubmit(42, 'key-1', 'hash-new'),
    ).resolves.toBeNull();

    const reclaimSql = String(manager.query.mock.calls[1][0]);
    expect(reclaimSql).toMatch(/UPDATE inquiry_idempotency_keys/i);
    expect(reclaimSql).toMatch(/response_json IS NULL/i);
    expect(reclaimSql).toMatch(/INTERVAL '10 minutes'/i);
    expect(manager.query.mock.calls[1][1]).toEqual([
      42,
      'submit_inquiry',
      'key-1',
      'hash-new',
    ]);
  });
});
