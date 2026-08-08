import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PortsController } from './ports.controller';
import { PortsAdminController } from './ports-admin.controller';
import { PortsService } from './ports.service';
import { Port } from './entities/port.entity';
import { Province } from '../provinces/entities/province.entity';
import { EpdaParameterGroupMember } from '../epda-parameters/entities/epda-parameter-group-member.entity';
import { EpdaParameterSet } from '../epda-parameters/entities/epda-parameter-set.entity';
import { EPDA_PORT_MEMBERSHIP_READER } from './epda-port-membership.reader';
import { TypeOrmEpdaPortMembershipReader } from './typeorm-epda-port-membership.reader';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Port,
      Province,
      EpdaParameterGroupMember,
      EpdaParameterSet,
    ]),
  ],
  controllers: [PortsController, PortsAdminController],
  providers: [
    TypeOrmEpdaPortMembershipReader,
    {
      provide: EPDA_PORT_MEMBERSHIP_READER,
      useExisting: TypeOrmEpdaPortMembershipReader,
    },
    PortsService,
  ],
  exports: [PortsService],
})
export class PortsModule {}
