import { InquiryCodeAllocator } from './inquiry-code-allocator';
import type { EntityManager, Repository } from 'typeorm';

describe('InquiryCodeAllocator', () => {
  it('uses the shared inquiry-code lock key for a prefix', () => {
    const allocator = new InquiryCodeAllocator();
    expect(allocator.lockKey('SA-2026-')).toBe('inquiry-code:SA-2026-');
  });

  it('acquires the advisory lock then reads MAX for the next code', async () => {
    const allocator = new InquiryCodeAllocator();
    const events: string[] = [];
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockImplementation(async () => {
        events.push('read');
        return { lastNumber: '9' };
      }),
    };
    const repository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    const manager = {
      query: jest.fn().mockImplementation(async () => {
        events.push('lock');
      }),
    };

    const code = await allocator.allocate(
      manager as unknown as EntityManager,
      repository as unknown as Repository<{ code: string | null }>,
      'SA-2026-',
    );

    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['inquiry-code:SA-2026-'],
    );
    expect(code).toBe('SA-2026-0010');
    expect(events).toEqual(['lock', 'read']);
  });
});
