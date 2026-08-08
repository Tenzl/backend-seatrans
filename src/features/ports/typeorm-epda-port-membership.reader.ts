import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EpdaParameterGroupMember } from '../epda-parameters/entities/epda-parameter-group-member.entity';
import { EpdaParameterSet } from '../epda-parameters/entities/epda-parameter-set.entity';
import type { EpdaPortMembershipReader } from './epda-port-membership.reader';

@Injectable()
export class TypeOrmEpdaPortMembershipReader
  implements EpdaPortMembershipReader
{
  constructor(
    @InjectRepository(EpdaParameterGroupMember)
    private readonly epdaGroupMemberRepository: Repository<EpdaParameterGroupMember>,
    @InjectRepository(EpdaParameterSet)
    private readonly epdaParameterSetRepository: Repository<EpdaParameterSet>,
  ) {}

  async findGroupLabel(portId: number): Promise<string | null> {
    const membership = await this.epdaGroupMemberRepository.findOne({
      where: { portId },
      relations: { group: true },
    });
    if (membership) {
      return String(membership.group?.name ?? membership.groupId);
    }

    // Keep checking JSONB during the membership-table compatibility window.
    const legacyGroup = await this.epdaParameterSetRepository
      .createQueryBuilder('parameterSet')
      .where(`parameterSet.scope = 'GROUP'`)
      .andWhere('parameterSet.memberPortIds @> :portIds::jsonb', {
        portIds: JSON.stringify([portId]),
      })
      .getOne();

    if (!legacyGroup) {
      return null;
    }

    return String(legacyGroup.name ?? legacyGroup.id);
  }
}
