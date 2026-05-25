import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PortsController } from './ports.controller';
import { PortsAdminController } from './ports-admin.controller';
import { PortsService } from './ports.service';
import { Port } from './entities/port.entity';
import { Province } from '../provinces/entities/province.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Port, Province])],
  controllers: [PortsController, PortsAdminController],
  providers: [PortsService],
  exports: [PortsService],
})
export class PortsModule {}
