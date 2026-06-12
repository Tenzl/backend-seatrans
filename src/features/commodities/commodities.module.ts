import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Commodity } from './entities/commodity.entity';
import { CargoTypeEntity } from './entities/cargo-type.entity';
import { ServiceType } from '../logistics/entities/service-type.entity';
import { CommoditiesService } from './commodities.service';
import { CargoTypesService } from './cargo-types.service';
import { CommoditiesController } from './commodities.controller';
import { CommoditiesAdminController } from './commodities-admin.controller';
import { CargoTypesController } from './cargo-types.controller';
import { CargoTypesAdminController } from './cargo-types-admin.controller';
import { CommoditiesSchemaBootstrap } from './commodities.schema-bootstrap';

@Module({
  imports: [TypeOrmModule.forFeature([Commodity, CargoTypeEntity, ServiceType])],
  providers: [CommoditiesService, CargoTypesService, CommoditiesSchemaBootstrap],
  controllers: [
    CommoditiesController,
    CommoditiesAdminController,
    CargoTypesController,
    CargoTypesAdminController,
  ],
  exports: [CommoditiesService, CargoTypesService],
})
export class CommoditiesModule {}
