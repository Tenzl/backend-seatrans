import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Commodity } from './entities/commodity.entity';
import { ServiceType } from '../logistics/entities/service-type.entity';
import { CommoditiesService } from './commodities.service';
import { CommoditiesController } from './commodities.controller';
import { CommoditiesAdminController } from './commodities-admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Commodity, ServiceType])],
  providers: [CommoditiesService],
  controllers: [CommoditiesController, CommoditiesAdminController],
  exports: [CommoditiesService],
})
export class CommoditiesModule {}
