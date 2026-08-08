import { BadRequestException } from '@nestjs/common';
import { BookingDocumentPayloadValidator } from '../booking-documents/booking-document-payload.validator';
import { BookingDocumentType } from '../booking-documents/enums/booking-document-type.enum';
import { formatCommodityInGroupLabel } from './commodity-display-label';
import type { CommodityGroupsService } from './commodity-groups.service';

describe('Arrival Notice commodity → descriptionOfGoods mapping', () => {
  it('formats description as "{commodity} IN {group}"', () => {
    expect(formatCommodityInGroupLabel('Rice', 'Foodstuffs')).toBe(
      'Rice IN Foodstuffs',
    );
  });

  it('fills empty AN descriptionOfGoods from commodityId via groups service', async () => {
    const commodityGroupsService = {
      resolveDisplayLabel: jest
        .fn()
        .mockResolvedValue('Rice IN Foodstuffs'),
    } as unknown as CommodityGroupsService;

    const validator = new BookingDocumentPayloadValidator(
      undefined,
      commodityGroupsService,
    );

    const result = (await validator.validate(
      BookingDocumentType.ARRIVAL_NOTICE,
      {
        commodityId: 7,
        containers: [],
      },
    )) as { descriptionOfGoods?: string; commodityId?: number };

    expect(commodityGroupsService.resolveDisplayLabel).toHaveBeenCalledWith(7);
    expect(result.descriptionOfGoods).toBe('Rice IN Foodstuffs');
  });

  it('does not overwrite an explicit descriptionOfGoods', async () => {
    const commodityGroupsService = {
      resolveDisplayLabel: jest
        .fn()
        .mockResolvedValue('Rice IN Foodstuffs'),
    } as unknown as CommodityGroupsService;

    const validator = new BookingDocumentPayloadValidator(
      undefined,
      commodityGroupsService,
    );

    const result = (await validator.validate(
      BookingDocumentType.ARRIVAL_NOTICE,
      {
        commodityId: 7,
        descriptionOfGoods: 'CUSTOM DESC',
        containers: [],
      },
    )) as { descriptionOfGoods?: string };

    expect(result.descriptionOfGoods).toBe('CUSTOM DESC');
  });

  it('maps booking commodityId to commodity displayLabel', async () => {
    const commodityGroupsService = {
      resolveDisplayLabel: jest
        .fn()
        .mockResolvedValue('Stone IN Minerals'),
    } as unknown as CommodityGroupsService;

    const validator = new BookingDocumentPayloadValidator(
      undefined,
      commodityGroupsService,
    );

    const result = (await validator.validate(
      BookingDocumentType.BOOKING_CONFIRMATION,
      {
        commodityId: 3,
        bookingNumber: 'BK-1',
      },
    )) as { commodity?: string };

    expect(result.commodity).toBe('Stone IN Minerals');
  });

  it('rejects unknown commodityId on booking', async () => {
    const commodityGroupsService = {
      resolveDisplayLabel: jest.fn().mockResolvedValue(null),
    } as unknown as CommodityGroupsService;

    const validator = new BookingDocumentPayloadValidator(
      undefined,
      commodityGroupsService,
    );

    await expect(
      validator.validate(BookingDocumentType.BOOKING_CONFIRMATION, {
        commodityId: 999,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
