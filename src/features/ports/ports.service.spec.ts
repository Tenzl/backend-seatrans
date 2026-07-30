import { ConflictException } from '@nestjs/common';
import { PortsService } from './ports.service';

describe('PortsService EPDA group area guard', () => {
  it('blocks an area change when only legacy JSONB membership exists', async () => {
    const legacyQuery = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 12,
        name: 'Legacy group',
      }),
    };
    const portRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 38,
        name: 'Chân Mây',
        portOfCall: 'Chân Mây',
        province: { id: 1, area: 1 },
      }),
    };
    const provinceRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 2, area: 2 }),
    };
    const membershipRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const parameterSetRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(legacyQuery),
    };
    const service = new PortsService(
      portRepository as never,
      provinceRepository as never,
      membershipRepository as never,
      parameterSetRepository as never,
    );

    await expect(
      service.updatePort(38, {
        name: 'Chân Mây',
        provinceId: 2,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(legacyQuery.andWhere).toHaveBeenCalledWith(
      'parameterSet.memberPortIds @> :portIds::jsonb',
      { portIds: '[38]' },
    );
  });
});
