import { TypeOrmEpdaPortMembershipReader } from './typeorm-epda-port-membership.reader';

describe('TypeOrmEpdaPortMembershipReader', () => {
  it('falls back to legacy JSONB membership when the table has no row', async () => {
    const legacyQuery = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 12,
        name: 'Legacy group',
      }),
    };
    const membershipRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const parameterSetRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(legacyQuery),
    };
    const reader = new TypeOrmEpdaPortMembershipReader(
      membershipRepository as never,
      parameterSetRepository as never,
    );

    await expect(reader.findGroupLabel(38)).resolves.toBe('Legacy group');
    expect(legacyQuery.andWhere).toHaveBeenCalledWith(
      'parameterSet.memberPortIds @> :portIds::jsonb',
      { portIds: '[38]' },
    );
  });
});
