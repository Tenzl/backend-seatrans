import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShippingAgencyInquiryEntity } from './entities/shipping-agency-inquiry.entity';
import { CharteringBrokerageInquiryEntity } from './entities/chartering-brokerage-inquiry.entity';
import { FreightForwardingInquiryEntity } from './entities/freight-forwarding-inquiry.entity';
import { TotalLogisticsInquiryEntity } from './entities/total-logistics-inquiry.entity';
import { SpecialRequestInquiryEntity } from './entities/special-request-inquiry.entity';
import { InquiryDocument } from './entities/inquiry-document.entity';
import { InquiryFieldChangeLog } from './entities/inquiry-field-change-log.entity';
import { ServiceType } from '../logistics/entities/service-type.entity';
import { User } from '../auth/entities/user.entity';
import { ServiceInquiryService } from './services/service-inquiry.service';
import { ShippingAgencyEpdaService } from './services/shipping-agency-epda.service';
import { InquiryDocumentService } from './services/inquiry-document.service';
import { InquiryFieldChangeService } from './services/inquiry-field-change.service';
import { InquirySchemaBootstrap } from './inquiry.schema-bootstrap';
import { PublicInquiryController } from './controllers/public-inquiry.controller';
import { AdminInquiryController } from './controllers/admin-inquiry.controller';
import { InquiryDocumentController } from './controllers/inquiry-document.controller';
import { AdminInquiryDocumentController } from './controllers/admin-inquiry-document.controller';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CloudinaryService } from '../../shared/services/cloudinary.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ShippingAgencyInquiryEntity,
      CharteringBrokerageInquiryEntity,
      FreightForwardingInquiryEntity,
      TotalLogisticsInquiryEntity,
      SpecialRequestInquiryEntity,
      InquiryDocument,
      InquiryFieldChangeLog,
      ServiceType,
      User,
    ]),
    NotificationModule,
  ],
  providers: [
    ServiceInquiryService,
    ShippingAgencyEpdaService,
    InquiryDocumentService,
    InquiryFieldChangeService,
    InquirySchemaBootstrap,
    RolesGuard,
    CloudinaryService,
  ],
  controllers: [
    PublicInquiryController,
    AdminInquiryController,
    AdminInquiryDocumentController,
    InquiryDocumentController,
  ],
  exports: [
    ServiceInquiryService,
    ShippingAgencyEpdaService,
    InquiryDocumentService,
    InquiryFieldChangeService,
  ],
})
export class InquiryModule {}
