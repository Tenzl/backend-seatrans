import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceInquiry } from './entities/service-inquiry.entity';
import { InquiryDocument } from './entities/inquiry-document.entity';
import { ServiceType } from '../logistics/entities/service-type.entity';
import { User } from '../auth/entities/user.entity';
import { ServiceInquiryService } from './services/service-inquiry.service';
import { InquiryDocumentService } from './services/inquiry-document.service';
import { PublicInquiryController } from './controllers/public-inquiry.controller';
import { AdminInquiryController } from './controllers/admin-inquiry.controller';
import { InquiryDocumentController } from './controllers/inquiry-document.controller';
import { AdminInquiryDocumentController } from './controllers/admin-inquiry-document.controller';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CloudinaryService } from '../../shared/services/cloudinary.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceInquiry, InquiryDocument, ServiceType, User]),
  ],
  providers: [ServiceInquiryService, InquiryDocumentService, RolesGuard, CloudinaryService],
  controllers: [
    PublicInquiryController,
    AdminInquiryController,
    AdminInquiryDocumentController,
    InquiryDocumentController,
  ],
  exports: [ServiceInquiryService, InquiryDocumentService],
})
export class InquiryModule {}
