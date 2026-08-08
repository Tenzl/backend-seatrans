import { ConflictException } from '@nestjs/common';
import { PortsService } from './ports.service';
import type { EpdaPortMembershipReader } from './epda-port-membership.reader';

describe('PortsService EPDA group area guard', () => {
  it('blocks an area change when EPDA membership reader finds a group', async () => {
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
    const epdaMembershipReader: EpdaPortMembershipReader = {
      findGroupLabel: jest.fn().mockResolvedValue('Legacy group'),
    };
    const cache = {
      deleteByPrefix: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PortsService(
      portRepository as never,
      provinceRepository as never,
      epdaMembershipReader,
      cache as never,
    );

    await expect(
      service.updatePort(38, {
        name: 'Chân Mây',
        provinceId: 2,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(epdaMembershipReader.findGroupLabel).toHaveBeenCalledWith(38);
  });
});
