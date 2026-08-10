import { BadRequestException } from '@nestjs/common';
import { PortsService } from './ports.service';

describe('PortsService inCharge validation', () => {
  function buildService(overrides?: {
    port?: Record<string, unknown>;
    province?: Record<string, unknown> | null;
  }) {
    const portRepository = {
      findOne: jest.fn().mockResolvedValue(
        overrides?.port ?? {
          id: 38,
          name: 'Chân Mây',
          portOfCall: 'CHAN MAY',
          province: { id: 1, area: 1 },
          type: 'PORT',
          inCharge: false,
        },
      ),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 38, ...value })),
      createQueryBuilder: jest.fn().mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      }),
    };
    const provinceRepository = {
      findOne: jest.fn().mockResolvedValue(
        overrides && 'province' in overrides
          ? overrides.province
          : { id: 2, area: 2 },
      ),
    };
    const cache = {
      deleteByPrefix: jest.fn().mockResolvedValue(undefined),
    };
    return new PortsService(
      portRepository as never,
      provinceRepository as never,
      cache as never,
    );
  }

  it('rejects inCharge without provinceId', async () => {
    const service = buildService({ province: null });

    await expect(
      service.createPort({
        name: 'Chân Mây',
        inCharge: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects inCharge when province area is outside 1-3', async () => {
    const service = buildService({ province: { id: 9, area: 9 } });

    await expect(
      service.createPort({
        name: 'Chân Mây',
        provinceId: 9,
        inCharge: true,
      }),
    ).rejects.toThrow('inCharge requires a province with area 1, 2, or 3');
  });

  it('allows province/area changes without EPDA membership checks', async () => {
    const service = buildService({
      port: {
        id: 38,
        name: 'Chân Mây',
        portOfCall: 'CHAN MAY',
        province: { id: 1, area: 1 },
        type: 'PORT',
        inCharge: false,
      },
      province: { id: 2, area: 2 },
    });

    await expect(
      service.updatePort(38, {
        name: 'Chân Mây',
        provinceId: 2,
      }),
    ).resolves.toMatchObject({
      name: 'Chân Mây',
      inCharge: false,
    });
  });
});
