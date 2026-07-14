import type { Request } from 'express';
import { AdminInquiryController } from './admin-inquiry.controller';
import { ServiceInquiryService } from '../services/service-inquiry.service';
import { ShippingAgencyEpdaService } from '../services/shipping-agency-epda.service';

describe('AdminInquiryController batch operations', () => {
  function setup() {
    const inquiryService = {
      hardDeleteBatchByAdmin: jest.fn().mockResolvedValue(undefined),
      softDeleteBatch: jest.fn().mockResolvedValue(undefined),
      restoreBatchByAdmin: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new AdminInquiryController(
      inquiryService as unknown as ServiceInquiryService,
      {} as ShippingAgencyEpdaService,
    );
    return { controller, inquiryService };
  }

  it('allows an administrator to delete across services when slug is omitted', async () => {
    const { controller, inquiryService } = setup();

    await controller.deleteBatch({ ids: [11, 12] }, {}, {
      user: { id: 7, role: { name: 'ROLE_ADMIN' } },
    } as Request & {
      user: { id: number; role: { name: string } };
    });

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
});
