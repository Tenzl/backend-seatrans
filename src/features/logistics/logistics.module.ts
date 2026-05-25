import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceType } from './entities/service-type.entity';
import { Office } from './entities/office.entity';
import { ServiceTypesService } from './service-types.service';
import { OfficesService } from './offices.service';
import { ServiceTypesController } from './service-types.controller';
import { OfficesController } from './offices.controller';
import { OfficesAdminController } from './offices-admin.controller';
import { Province } from '../provinces/entities/province.entity';
import { Commodity } from '../commodities/entities/commodity.entity';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [TypeOrmModule.forFeature([ServiceType, Office, Province, Commodity])],
  providers: [ServiceTypesService, OfficesService, RolesGuard],
  controllers: [ServiceTypesController, OfficesController, OfficesAdminController],
  exports: [ServiceTypesService, OfficesService],
})
export class LogisticsModule {}
