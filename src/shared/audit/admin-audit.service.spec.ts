import { Repository } from 'typeorm';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminAuditLog,
  AdminAuditStatus,
} from './entities/admin-audit-log.entity';

describe('AdminAuditService', () => {
  it('persists explicitly supplied request details when an audit starts', async () => {
    const create = jest.fn((value: Partial<AdminAuditLog>) => value);
    const save = jest
      .fn()
      .mockImplementation((value: Partial<AdminAuditLog>) =>
        Promise.resolve({ ...value, id: 8 }),
      );
    const repository = { create, save } as unknown as Repository<AdminAuditLog>;
    const service = new AdminAuditService(repository);

    await expect(
      service.begin({
        actorUserId: 3,
        details: { resourceIds: [10, 11] },
        method: 'DELETE',
        requestPath: '/api/v1/admin/inquiries/batch/permanent',
        resourceId: null,
        resourceType: 'inquiry_batch',
      }),
    ).resolves.toEqual({ id: 8 });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { resourceIds: [10, 11] },
        status: AdminAuditStatus.STARTED,
      }),
    );
  });

  it('merges result details without losing the original target identifiers', async () => {
    const audit = {
      id: 8,
      details: { resourceIds: [10, 11] },
      status: AdminAuditStatus.STARTED,
      completedAt: null,
    } as AdminAuditLog;
    const findOneBy = jest.fn().mockResolvedValue(audit);
    const save = jest.fn().mockResolvedValue(audit);
    const repository = {
      findOneBy,
      save,
    } as unknown as Repository<AdminAuditLog>;
    const service = new AdminAuditService(repository);

    await service.succeed(8, { deletedCount: 2 });

    expect(audit.details).toEqual({
      resourceIds: [10, 11],
      deletedCount: 2,
    });
    expect(audit.status).toBe(AdminAuditStatus.SUCCEEDED);
    expect(audit.completedAt).toBeInstanceOf(Date);
    expect(save).toHaveBeenCalledWith(audit);
  });
});
