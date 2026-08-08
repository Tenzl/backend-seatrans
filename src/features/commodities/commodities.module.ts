import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GalleryImage } from '../gallery/entities/gallery-image.entity';
import { FreightForwardingInquiryEntity } from '../inquiry/entities/freight-forwarding-inquiry.entity';
import { ShippingAgencyInquiryEntity } from '../inquiry/entities/shipping-agency-inquiry.entity';
import { TotalLogisticsInquiryEntity } from '../inquiry/entities/total-logistics-inquiry.entity';
import { ServiceType } from '../logistics/entities/service-type.entity';
import { CommodityGroup } from './entities/commodity-group.entity';
import { Commodity } from './entities/commodity.entity';
import { CommoditiesService } from './commodities.service';
import { CommodityGroupsService } from './commodity-groups.service';
import { CommoditiesController } from './commodities.controller';
import { CommoditiesAdminController } from './commodities-admin.controller';
import { CommodityGroupsAdminController } from './commodity-groups-admin.controller';
import { COMMODITY_USAGE_CHECKER } from './ports/commodity-usage.checker';
import { TypeOrmCommodityUsageChecker } from './ports/typeorm-commodity-usage.checker';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Commodity,
      CommodityGroup,
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
    CommodityGroupsService,
  ],
  controllers: [
    CommoditiesController,
    CommoditiesAdminController,
    CommodityGroupsAdminController,
  ],
  exports: [CommoditiesService, CommodityGroupsService],
})
export class CommoditiesModule {}
