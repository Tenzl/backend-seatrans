import { validateDto } from '../../../shared/utils/validate-dto.util';
import { UpdateShippingAgencyEpdaDto } from './update-shipping-agency-epda.dto';

describe('Agency other expenses EPDA DTO', () => {
  it('accepts a valid agencyOtherExpenses array', async () => {
    const dto = await validateDto(UpdateShippingAgencyEpdaDto, {
      agencyFeeMode: 'LUMPSUM',
      agencyLumpsumAmount: 1500,
      agencyOtherExpenses: [
        { name: 'Customs overtime', amount: 120 },
        { name: 'Extra launch', amount: 0 },
      ],
    });

    expect(dto.agencyOtherExpenses).toEqual([
      { name: 'Customs overtime', amount: 120 },
      { name: 'Extra launch', amount: 0 },
    ]);
  });

  it('trims fee names and rejects blank names', async () => {
    const dto = await validateDto(UpdateShippingAgencyEpdaDto, {
      agencyOtherExpenses: [{ name: '  Launch hire  ', amount: 50 }],
    });
    expect(dto.agencyOtherExpenses?.[0]?.name).toBe('Launch hire');

    await expect(
      validateDto(UpdateShippingAgencyEpdaDto, {
        agencyOtherExpenses: [{ name: '   ', amount: 10 }],
      }),
    ).rejects.toBeDefined();
  });

  it('rejects negative amounts', async () => {
    await expect(
      validateDto(UpdateShippingAgencyEpdaDto, {
        agencyOtherExpenses: [{ name: 'Fee', amount: -1 }],
      }),
    ).rejects.toBeDefined();
  });

  it('allows null to clear agencyOtherExpenses', async () => {
    const dto = await validateDto(UpdateShippingAgencyEpdaDto, {
      agencyOtherExpenses: null,
    });
    expect(dto.agencyOtherExpenses).toBeNull();
  });
});
