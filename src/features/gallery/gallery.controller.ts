import { Controller, Get, Query } from '@nestjs/common';
import { GalleryService } from './gallery.service';
import { GalleryListQueryDto } from './dto/gallery-list-query.dto';

@Controller('v1/gallery')
export class GalleryController {
  constructor(private readonly galleryService: GalleryService) {}

  @Get('images')
  listImages(@Query() query: GalleryListQueryDto) {
    return this.galleryService.getPublicPaged(query);
  }
}
