import type { Request } from 'express';
import { AdminInquiryController } from './admin-inquiry.controller';
import { ServiceInquiryService } from '../services/service-inquiry.service';
import { ShippingAgencyEpdaService } from '../services/shipping-agency-epda.service';

describe('AdminInquiryController batch operations', () => {
  function setup() {
    const inquiryService = {
      hardDeleteBatchByAdmin: jest.fn().mockResolvedValue(undefined),
      hardDeleteByServiceAndId: jest.fn().mockResolvedValue(undefined),
      softDeleteBatch: jest.fn().mockResolvedValue(undefined),
      restoreBatchByAdmin: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new AdminInquiryController(
      inquiryService as unknown as ServiceInquiryService,
      {} as ShippingAgencyEpdaService,
    );
    return { controller, inquiryService };
  }

  it('archives through the standard batch route even for administrators', async () => {
    const { controller, inquiryService } = setup();

    await controller.deleteBatch({ ids: [11, 12] }, {}, {
      user: { id: 7, role: { name: 'ROLE_ADMIN' } },
    } as Request & {
      user: { id: number; role: { name: string } };
    });

    expect(inquiryService.hardDeleteBatchByAdmin).not.toHaveBeenCalled();
    expect(inquiryService.softDeleteBatch).toHaveBeenCalledWith(
      [11, 12],
      7,
      undefined,
    );
  });

  it('uses a separate admin-only method for permanent batch deletion', async () => {
    const { controller, inquiryService } = setup();

    await controller.hardDeleteBatch({ ids: [11, 12] }, {});

    expect(inquiryService.hardDeleteBatchByAdmin).toHaveBeenCalledWith(
      [11, 12],
      undefined,
    );
  });

  it('allows an administrator to restore across services when slug is omitted', async () => {
    const { controller, inquiryService } = setup();

    await controller.restoreBatch({ ids: [11, 12] }, {}, {
      user: { id: 7, role: { name: 'ROLE_ADMIN' } },
    } as Request & {
      user: { id: number; role: { name: string } };
    });

    expect(inquiryService.restoreBatchByAdmin).toHaveBeenCalledWith(
      [11, 12],
      undefined,
    );
  });

  it('never hard-deletes for an admin-like custom role', async () => {
    const { controller, inquiryService } = setup();
    const request = {
      user: { id: 8, role: { name: 'ROLE_ADMIN_ASSISTANT' } },
    } as Request & {
      user: { id: number; role: { name: string } };
    };

    await controller.deleteBatch({ ids: [11, 12] }, {}, request);
    await controller.remove('shipping-agency', 13, request);

    expect(inquiryService.hardDeleteBatchByAdmin).not.toHaveBeenCalled();
    expect(inquiryService.hardDeleteByServiceAndId).not.toHaveBeenCalled();
    expect(inquiryService.softDeleteBatch).toHaveBeenNthCalledWith(
      1,
      [11, 12],
      8,
      undefined,
    );
    expect(inquiryService.softDeleteBatch).toHaveBeenNthCalledWith(
      2,
      [13],
      8,
      'shipping-agency',
    );
  });
});
