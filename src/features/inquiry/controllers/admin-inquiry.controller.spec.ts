import { AdminInquiryController } from './admin-inquiry.controller';
import { ServiceInquiryService } from '../services/service-inquiry.service';
import { ShippingAgencyEpdaService } from '../services/shipping-agency-epda.service';

describe('AdminInquiryController batch operations', () => {
  function setup() {
    const inquiryService = {
      hardDeleteBatch: jest.fn().mockResolvedValue(undefined),
      hardDeleteByServiceAndId: jest.fn().mockResolvedValue(undefined),
    };
    const shippingAgencyEpdaService = {
      unlockEpda: jest.fn().mockResolvedValue({ id: 13, epdaLockedAt: null }),
    };
    const controller = new AdminInquiryController(
      inquiryService as unknown as ServiceInquiryService,
      shippingAgencyEpdaService as unknown as ShippingAgencyEpdaService,
    );
    return { controller, inquiryService, shippingAgencyEpdaService };
  }

  it('hard deletes through the standard batch route', async () => {
    const { controller, inquiryService } = setup();

    await controller.deleteBatch({ ids: [11, 12] }, {});

    expect(inquiryService.hardDeleteBatch).toHaveBeenCalledWith(
      [11, 12],
      undefined,
    );
  });

  it('hard deletes a single inquiry through the standard route', async () => {
    const { controller, inquiryService } = setup();

    await controller.remove('shipping-agency', 13);

    expect(inquiryService.hardDeleteByServiceAndId).toHaveBeenCalledWith(
      'shipping-agency',
      13,
    );
  });

  it('unlocks EPDA with the authenticated admin actor', async () => {
    const { controller, shippingAgencyEpdaService } = setup();

    await controller.unlockShippingAgencyEpda(13, {
      user: { id: 7, role: { name: 'ROLE_ADMIN' } },
    } as never);

    expect(shippingAgencyEpdaService.unlockEpda).toHaveBeenCalledWith(13, 7);
  });
});
