import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GalleryImage } from '../gallery/entities/gallery-image.entity';
import { FreightForwardingInquiryEntity } from '../inquiry/entities/freight-forwarding-inquiry.entity';
import { ShippingAgencyInquiryEntity } from '../inquiry/entities/shipping-agency-inquiry.entity';
import { TotalLogisticsInquiryEntity } from '../inquiry/entities/total-logistics-inquiry.entity';
import { ServiceType } from '../logistics/entities/service-type.entity';
import { CommodityType } from './entities/commodity-type.entity';
import { Commodity } from './entities/commodity.entity';
import { CommoditiesService } from './commodities.service';
import { CommodityTypesService } from './commodity-types.service';
import { CommoditiesController } from './commodities.controller';
import { CommoditiesAdminController } from './commodities-admin.controller';
import { CommodityTypesAdminController } from './commodity-types-admin.controller';
import { COMMODITY_USAGE_CHECKER } from './ports/commodity-usage.checker';
import { TypeOrmCommodityUsageChecker } from './ports/typeorm-commodity-usage.checker';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Commodity,
      CommodityType,
      ServiceType,
      GalleryImage,
      ShippingAgencyInquiryEntity,
      FreightForwardingInquiryEntity,
      TotalLogisticsInquiryEntity,
    ]),
  ],
  providers: [
    TypeOrmCommodityUsageChecker,
    {
      provide: COMMODITY_USAGE_CHECKER,
      useExisting: TypeOrmCommodityUsageChecker,
    },
    CommoditiesService,
    CommodityTypesService,
  ],
  controllers: [
    CommoditiesController,
    CommoditiesAdminController,
    CommodityTypesAdminController,
  ],
  exports: [CommoditiesService, CommodityTypesService],
})
export class CommoditiesModule {}
