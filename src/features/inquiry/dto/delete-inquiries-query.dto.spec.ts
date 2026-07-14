import { validateDto } from '../../../shared/utils/validate-dto.util';
import {
  DeleteInquiriesQueryDto,
  PublicDeleteInquiriesQueryDto,
} from './delete-inquiries-query.dto';

describe('DeleteInquiriesQueryDto', () => {
  it.each([
    'shipping-agency',
    'chartering',
    'freight-forwarding',
    'total-logistic',
    'special-request',
  ])('accepts canonical service slug %s', async (serviceSlug) => {
    await expect(
      validateDto(PublicDeleteInquiriesQueryDto, { serviceSlug }),
    ).resolves.toMatchObject({ serviceSlug });
  });

  it('requires serviceSlug', async () => {
    await expect(
      validateDto(PublicDeleteInquiriesQueryDto, {}),
    ).rejects.toBeDefined();
  });

  it.each(['SHIPPING AGENCY', 'total-logistics', 'unknown-service'])(
    'rejects non-canonical service slug %s',
    async (serviceSlug) => {
      await expect(
        validateDto(PublicDeleteInquiriesQueryDto, { serviceSlug }),
      ).rejects.toBeDefined();
    },
  );

  it('keeps serviceSlug optional for admin all-service operations', async () => {
    await expect(validateDto(DeleteInquiriesQueryDto, {})).resolves.toEqual({});
  });
});
