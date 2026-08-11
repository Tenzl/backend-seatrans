import { TypeOrmEpdaPortMembershipReader } from './typeorm-epda-port-membership.reader';

describe('TypeOrmEpdaPortMembershipReader', () => {
  it('reads group label only from epda_parameter_group_members', async () => {
    const membershipRepository = {
      findOne: jest.fn().mockResolvedValue({
        groupId: 12,
        portId: 38,
        group: { id: 12, name: 'North group' },
      }),
    };
    const reader = new TypeOrmEpdaPortMembershipReader(
      membershipRepository as never,
    );

    await expect(reader.findGroupLabel(38)).resolves.toBe('North group');
    expect(membershipRepository.findOne).toHaveBeenCalledWith({
      where: { portId: 38 },
      relations: { group: true },
    });
  });

  it('returns null when the membership table has no row', async () => {
    const membershipRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const reader = new TypeOrmEpdaPortMembershipReader(
      membershipRepository as never,
    );

    await expect(reader.findGroupLabel(38)).resolves.toBeNull();
  });
});
