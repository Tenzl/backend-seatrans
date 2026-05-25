import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GalleryImage } from './entities/gallery-image.entity';
import { Commodity } from '../commodities/entities/commodity.entity';
import { Province } from '../provinces/entities/province.entity';
import { Port } from '../ports/entities/port.entity';
import { GalleryService } from './gallery.service';
import { GalleryController } from './gallery.controller';
import { GalleryAdminController } from './gallery-admin.controller';
import { CloudinaryService } from '../../shared/services/cloudinary.service';

@Module({
  imports: [TypeOrmModule.forFeature([GalleryImage, Commodity, Province, Port])],
  providers: [GalleryService, CloudinaryService],
  controllers: [GalleryController, GalleryAdminController],
})
export class GalleryModule {}
