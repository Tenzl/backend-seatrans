import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GalleryImage } from '../gallery/entities/gallery-image.entity';
import { FreightForwardingInquiryEntity } from '../inquiry/entities/freight-forwarding-inquiry.entity';
import { ShippingAgencyInquiryEntity } from '../inquiry/entities/shipping-agency-inquiry.entity';
import { TotalLogisticsInquiryEntity } from '../inquiry/entities/total-logistics-inquiry.entity';
import { ServiceType } from '../logistics/entities/service-type.entity';
import { Commodity } from './entities/commodity.entity';
import { CommoditiesService } from './commodities.service';
import { CommoditiesController } from './commodities.controller';
import { CommoditiesAdminController } from './commodities-admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Commodity,
      ServiceType,
      GalleryImage,
      ShippingAgencyInquiryEntity,
      FreightForwardingInquiryEntity,
      TotalLogisticsInquiryEntity,
    ]),
  ],
  providers: [CommoditiesService],
  controllers: [CommoditiesController, CommoditiesAdminController],
  exports: [CommoditiesService],
})
export class CommoditiesModule {}
