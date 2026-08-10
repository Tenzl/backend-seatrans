import { validateDto } from '../../../shared/utils/validate-dto.util';
import { CreateInternalShippingAgencyInquiryDto } from './create-internal-shipping-agency-inquiry.dto';
import { UpdateShippingAgencyEpdaDto } from './update-shipping-agency-epda.dto';

describe('shipping-agency EPDA DTO contract', () => {
  it('accepts HN and retains every create-only EPDA field', async () => {
    const dto = await validateDto(CreateInternalShippingAgencyInquiryDto, {
      shipownerTo: 'Owner',
      vesselName: 'MV Test',
      portId: 21,
      portOfCall: 'HAI PHONG',
      dischargeLoadingLocation: 'BERTH',
      quoteForm: 'HN',
      cargoNameOther: 'Project cargo',
      quantityTons: 1250,
      boatHireAmount: 100,
      tallyFeeAmount: 200,
      tugAssistanceAmount: 300,
      transportLs: 'Taxi',
      transportQuarantine: 'Launch',
    });

    expect(dto).toMatchObject({
      quoteForm: 'HN',
      portId: 21,
      cargoNameOther: 'Project cargo',
      quantityTons: 1250,
      boatHireAmount: 100,
      tallyFeeAmount: 200,
      tugAssistanceAmount: 300,
      transportLs: 'Taxi',
      transportQuarantine: 'Launch',
    });
  });

  it('accepts HN for draft updates and preserves explicit null clears', async () => {
    const dto = await validateDto(UpdateShippingAgencyEpdaDto, {
      quoteForm: 'HN',
      portId: null,
      boatHireAmount: null,
      shorecraneHireUsdPerMt: null,
      berthHours: null,
      anchorageHours: null,
      pilotage3rdMiles: null,
    });

    expect(dto).toMatchObject({
      quoteForm: 'HN',
      portId: null,
      boatHireAmount: null,
      shorecraneHireUsdPerMt: null,
      berthHours: null,
      anchorageHours: null,
      pilotage3rdMiles: null,
    });
  });

  it('rejects client-owned epdaSnapshot from create drafts', async () => {
    await expect(
      validateDto(CreateInternalShippingAgencyInquiryDto, {
        shipownerTo: 'Owner',
        vesselName: 'MV Test',
        portId: 21,
        portOfCall: 'HAI PHONG',
        dischargeLoadingLocation: 'BERTH',
        quoteForm: 'HN',
        epdaSnapshot: { shouldNot: 'persist' },
      }),
    ).rejects.toMatchObject({
      response: {
        message: 'Request validation failed',
        details: [
          {
            field: 'epdaSnapshot',
            message: 'property epdaSnapshot should not exist',
          },
        ],
      },
    });
  });

  it('requires canonical portId for every internal EPDA draft', async () => {
    await expect(
      validateDto(CreateInternalShippingAgencyInquiryDto, {
        shipownerTo: 'Owner',
        vesselName: 'MV Test',
        dischargeLoadingLocation: 'BERTH',
      }),
    ).rejects.toBeDefined();
  });

  it('does not require client-owned portOfCall or quoteForm fields', async () => {
    const dto = await validateDto(CreateInternalShippingAgencyInquiryDto, {
      shipownerTo: 'Owner',
      vesselName: 'MV Test',
      portId: 21,
      dischargeLoadingLocation: 'BERTH',
    });

    expect(dto.portId).toBe(21);
    expect(dto.portOfCall).toBeUndefined();
    expect(dto.quoteForm).toBeUndefined();
  });

  it('accepts a partial draft without complete-only vessel fields', async () => {
    const dto = await validateDto(CreateInternalShippingAgencyInquiryDto, {
      portId: 21,
    });

    expect(dto).toMatchObject({ portId: 21 });
  });

  it('rejects client-owned completeness and create working parameters', async () => {
    await expect(
      validateDto(CreateInternalShippingAgencyInquiryDto, {
        portId: 21,
        isComplete: true,
        epdaWorkingParams: { coeff: { clearanceFee: 1 } },
      }),
    ).rejects.toMatchObject({
      response: {
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'isComplete' }),
          expect.objectContaining({ field: 'epdaWorkingParams' }),
        ]) as unknown[],
      },
    });
  });

  it('rejects client-owned completeness on draft updates', async () => {
    await expect(
      validateDto(UpdateShippingAgencyEpdaDto, { isComplete: false }),
    ).rejects.toMatchObject({
      response: {
        details: [
          expect.objectContaining({ field: 'isComplete' }),
        ] as unknown[],
      },
    });
  });

  it('rejects a client owner supplied by an internal create caller', async () => {
    await expect(
      validateDto(CreateInternalShippingAgencyInquiryDto, {
        customerUserId: 10,
        portId: 21,
      }),
    ).rejects.toMatchObject({
      response: {
        details: [
          {
            field: 'customerUserId',
            message: 'property customerUserId should not exist',
          },
        ],
      },
    });
  });
});
