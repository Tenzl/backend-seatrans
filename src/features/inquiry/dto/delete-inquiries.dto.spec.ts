import { validateDto } from '../../../shared/utils/validate-dto.util';
import { DeleteInquiriesDto } from './delete-inquiries.dto';

describe('DeleteInquiriesDto', () => {
  it('rejects duplicate IDs', async () => {
    await expect(
      validateDto(DeleteInquiriesDto, { ids: [10, 10] }),
    ).rejects.toBeDefined();
  });

  it('caps batch size to protect database and audit operations', async () => {
    await expect(
      validateDto(DeleteInquiriesDto, {
        ids: Array.from({ length: 501 }, (_, index) => index + 1),
      }),
    ).rejects.toBeDefined();
  });
});
