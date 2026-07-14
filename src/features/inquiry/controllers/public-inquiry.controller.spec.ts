import type { Request } from 'express';
import { PublicInquiryController } from './public-inquiry.controller';
import { ServiceInquiryService } from '../services/service-inquiry.service';
import { DeleteInquiriesDto } from '../dto/delete-inquiries.dto';
import { PublicDeleteInquiriesQueryDto } from '../dto/delete-inquiries-query.dto';

type DeleteBatchHandler = (
  dto: DeleteInquiriesDto,
  query: PublicDeleteInquiriesQueryDto,
  req: Request & { user?: { id?: number } },
) => Promise<{ deletedCount: number }>;

describe('PublicInquiryController batch delete', () => {
  it('passes the authenticated user and canonical query slug to the service', async () => {
    const inquiryService = {
      softDeleteBatchByUser: jest.fn().mockResolvedValue({ deletedCount: 2 }),
    };
    const controller = new PublicInquiryController(
      inquiryService as unknown as ServiceInquiryService,
    );
    const deleteBatch = controller.deleteMyInquiries.bind(
      controller,
    ) as unknown as DeleteBatchHandler;

    await expect(
      deleteBatch({ ids: [11, 12] }, { serviceSlug: 'shipping-agency' }, {
        user: { id: 42 },
      } as Request & { user: { id: number } }),
    ).resolves.toEqual({ deletedCount: 2 });

    expect(inquiryService.softDeleteBatchByUser).toHaveBeenCalledWith(
      42,
      [11, 12],
      'shipping-agency',
    );
  });
});
