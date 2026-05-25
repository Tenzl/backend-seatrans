import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiAdmin } from '../../shared/decorators/api-admin.decorator';
import { GalleryService } from './gallery.service';
import { CreateGalleryImageDto } from './dto/create-gallery-image.dto';
import { UpdateGalleryImageDto } from './dto/update-gallery-image.dto';
import { GalleryListQueryDto } from './dto/gallery-list-query.dto';
import { GalleryMultipartFieldsDto } from './dto/gallery-multipart-fields.dto';
import { validateDto } from '../../shared/utils/validate-dto.util';

@ApiAdmin()
@Controller('v1/admin/gallery-images')
export class GalleryAdminController {
  constructor(private readonly galleryService: GalleryService) {}

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FilesInterceptor('files', 30))
  async uploadBatch(
    @UploadedFiles() files: Array<{ buffer: Buffer }>,
    @Body() body: Record<string, unknown>,
  ) {
    const fields = await validateDto(GalleryMultipartFieldsDto, body);
    return this.galleryService.uploadMultiple(files, fields.toCreateDto(), 1);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async uploadSingle(
    @UploadedFile() file: { buffer: Buffer },
    @Body() body: Record<string, unknown>,
  ) {
    const fields = await validateDto(GalleryMultipartFieldsDto, body);
    return this.galleryService.uploadSingle(file, fields.toCreateDto(), 1);
  }

  @Post('from-url')
  @HttpCode(HttpStatus.CREATED)
  saveFromUrl(@Body() dto: CreateGalleryImageDto) {
    return this.galleryService.saveImageFromUrl(dto, 1);
  }

  @Get()
  list(@Query() query: GalleryListQueryDto) {
    if (query.unpaged) {
      return this.galleryService.getAdminImagesAll(query.size);
    }
    return this.galleryService.getAdminImages(query);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.galleryService.getById(Number(id));
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateGalleryImageDto) {
    return this.galleryService.update(Number(id), dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.galleryService.delete(Number(id));
  }
}
