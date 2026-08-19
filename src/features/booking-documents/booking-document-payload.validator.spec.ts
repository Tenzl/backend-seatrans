import { BadRequestException } from '@nestjs/common';
import { BookingDocumentPayloadValidator } from './booking-document-payload.validator';
import { BookingDocumentType } from './enums/booking-document-type.enum';
import { CommodityTypesService } from '../commodities/commodity-types.service';
import type { Repository } from 'typeorm';
import { CommodityType } from '../commodities/entities/commodity-type.entity';
import { Commodity } from '../commodities/entities/commodity.entity';
import { ServiceType } from '../logistics/entities/service-type.entity';

describe('BookingDocumentPayloadValidator independent catalogs', () => {
  function subject(
    selection = {
      commodityTypeId: 11,
      commodityTypeName: 'Bulk',
      commodityId: 22,
      commodityName: 'Rice',
    },
  ) {
    const resolveSelection = jest.fn().mockResolvedValue(selection);
    const commodityTypesService = {
      resolveFreightForwardingSelection: resolveSelection,
    } as unknown as CommodityTypesService;
    return {
      validator: new BookingDocumentPayloadValidator(
        undefined,
        commodityTypesService,
      ),
      commodityTypesService,
      resolveSelection,
    };
  }

  it('normalizes independent Booking IDs and stable snapshots', async () => {
    const { validator, resolveSelection } = subject();

    const result = await validator.validate(
      BookingDocumentType.BOOKING_CONFIRMATION,
      { commodityTypeId: 11, commodityId: 22 },
    );

    expect(resolveSelection).toHaveBeenCalledWith(11, 22);
    expect(result).toMatchObject({
      commodityTypeId: 11,
      commodityId: 22,
      commodityType: 'Bulk',
      commodityName: 'Rice',
      commodity: 'Rice IN Bulk',
    });
  });

  it('allows an arbitrary same-Service Type and Commodity combination for AN', async () => {
    const { validator } = subject({
      commodityTypeId: 31,
      commodityTypeName: 'Reefer',
      commodityId: 42,
      commodityName: 'Steel coils',
    });

    const result = await validator.validate(
      BookingDocumentType.ARRIVAL_NOTICE,
      { commodityTypeId: 31, commodityId: 42, containers: [] },
    );

    expect(result).toMatchObject({
      commodityType: 'Reefer',
      commodityName: 'Steel coils',
      descriptionOfGoods: 'Steel coils IN Reefer',
    });
  });

  it('keeps a legacy commodityId and historical Booking description unchanged', async () => {
    const { validator } = subject({
      commodityTypeId: null,
      commodityTypeName: null,
      commodityId: 22,
      commodityName: 'Renamed commodity',
    });

    const result = await validator.validate(
      BookingDocumentType.BOOKING_CONFIRMATION,
      { commodityId: 22, commodity: 'Historical commodity IN Old group' },
    );

    expect(result).toMatchObject({
      commodityId: 22,
      commodity: 'Historical commodity IN Old group',
    });
  });

  it('keeps stored AN snapshots and description unchanged after catalog rename', async () => {
    const { validator } = subject({
      commodityTypeId: 11,
      commodityTypeName: 'Renamed Type',
      commodityId: 22,
      commodityName: 'Renamed Commodity',
    });

    const result = await validator.validate(
      BookingDocumentType.ARRIVAL_NOTICE,
      {
        commodityTypeId: 11,
        commodityId: 22,
        commodityType: 'Old Type',
        commodityName: 'Old Commodity',
        descriptionOfGoods: 'Old Commodity IN Old Type',
        containers: [],
      },
    );

    expect(result).toMatchObject({
      commodityType: 'Old Type',
      commodityName: 'Old Commodity',
      descriptionOfGoods: 'Old Commodity IN Old Type',
    });
  });

  it('propagates independent Service validation failures', async () => {
    const { validator, commodityTypesService } = subject();
    jest
      .spyOn(commodityTypesService, 'resolveFreightForwardingSelection')
      .mockRejectedValue(
        new BadRequestException(
          'Commodity Type does not belong to Freight Forwarding Service',
        ),
      );

    await expect(
      validator.validate(BookingDocumentType.BOOKING_CONFIRMATION, {
        commodityTypeId: 999,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CommodityTypesService Freight Forwarding resolution', () => {
  function subject(typeServiceId = 7, commodityServiceId = 7) {
    const typeRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 11,
        serviceTypeId: typeServiceId,
        code: 'IN_BULK',
        name: 'Bulk',
      }),
    };
    const commodityRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 22,
        serviceTypeId: commodityServiceId,
        name: 'RICE',
        displayName: 'Rice',
      }),
    };
    const serviceTypeRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 7,
          name: 'Freight Forwarding',
          displayName: 'Freight Forwarding',
        },
      ]),
    };
    return new CommodityTypesService(
      typeRepository as unknown as Repository<CommodityType>,
      serviceTypeRepository as unknown as Repository<ServiceType>,
      commodityRepository as unknown as Repository<Commodity>,
    );
  }

  it('resolves an arbitrary pair using independent Service checks', async () => {
    await expect(
      subject().resolveFreightForwardingSelection(11, 22),
    ).resolves.toEqual({
      commodityTypeId: 11,
      commodityTypeName: 'Bulk',
      commodityId: 22,
      commodityName: 'Rice',
    });
  });

  it.each([
    ['Type', 8, 7],
    ['Commodity', 7, 8],
  ])(
    'rejects a cross-Service %s independently',
    async (_label, typeId, commodityId) => {
      await expect(
        subject(typeId, commodityId).resolveFreightForwardingSelection(11, 22),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});
