import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EpdaParameterGroupMember } from '../epda-parameters/entities/epda-parameter-group-member.entity';
import type { EpdaPortMembershipReader } from './epda-port-membership.reader';

@Injectable()
export class TypeOrmEpdaPortMembershipReader
  implements EpdaPortMembershipReader
{
  constructor(
    @InjectRepository(EpdaParameterGroupMember)
    private readonly epdaGroupMemberRepository: Repository<EpdaParameterGroupMember>,
  ) {}

  async findGroupLabel(portId: number): Promise<string | null> {
    const membership = await this.epdaGroupMemberRepository.findOne({
      where: { portId },
      relations: { group: true },
    });
    if (!membership) {
      return null;
    }
    return String(membership.group?.name ?? membership.groupId);
  }
}
