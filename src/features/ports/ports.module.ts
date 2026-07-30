import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PortsController } from './ports.controller';
import { PortsAdminController } from './ports-admin.controller';
import { PortsService } from './ports.service';
import { Port } from './entities/port.entity';
import { Province } from '../provinces/entities/province.entity';
import { EpdaParameterGroupMember } from '../epda-parameters/entities/epda-parameter-group-member.entity';
import { EpdaParameterSet } from '../epda-parameters/entities/epda-parameter-set.entity';

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
  providers: [PortsService],
  exports: [PortsService],
})
export class PortsModule {}
