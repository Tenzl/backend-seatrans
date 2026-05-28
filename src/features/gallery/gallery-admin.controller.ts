import {
  Body,
  BadRequestException,
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
  Req,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { ApiAdmin } from '../../shared/decorators/api-admin.decorator';
import { GalleryService } from './gallery.service';
import { CreateGalleryImageDto } from './dto/create-gallery-image.dto';
import { UpdateGalleryImageDto } from './dto/update-gallery-image.dto';
import { GalleryListQueryDto } from './dto/gallery-list-query.dto';
import { GalleryMultipartFieldsDto } from './dto/gallery-multipart-fields.dto';
import { validateDto } from '../../shared/utils/validate-dto.util';
import { allowMimeTypes, MB } from '../../shared/uploads/upload-validators';

@ApiAdmin()
@Controller('v1/admin/gallery-images')
export class GalleryAdminController {
  constructor(private readonly galleryService: GalleryService) {}

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FilesInterceptor('files', 30, {
      limits: { fileSize: 10 * MB, files: 30 },
      fileFilter: allowMimeTypes(['image/jpeg', 'image/png', 'image/webp']),
    }),
  )
  async uploadBatch(
    @UploadedFiles() files: Array<{ buffer: Buffer }>,
    @Body() body: Record<string, unknown>,
    @Req() req: Request & { user?: { id?: number } },
  ) {
    const fields = await validateDto(GalleryMultipartFieldsDto, body);
    const uploaderUserId = req.user?.id;
    if (!uploaderUserId) throw new BadRequestException('User not authenticated');
    return this.galleryService.uploadMultiple(files, fields.toCreateDto(), uploaderUserId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * MB, files: 1 },
      fileFilter: allowMimeTypes(['image/jpeg', 'image/png', 'image/webp']),
    }),
  )
  async uploadSingle(
    @UploadedFile() file: { buffer: Buffer },
    @Body() body: Record<string, unknown>,
    @Req() req: Request & { user?: { id?: number } },
  ) {
    const fields = await validateDto(GalleryMultipartFieldsDto, body);
    const uploaderUserId = req.user?.id;
    if (!uploaderUserId) throw new BadRequestException('User not authenticated');
    return this.galleryService.uploadSingle(file, fields.toCreateDto(), uploaderUserId);
  }

  @Post('from-url')
  @HttpCode(HttpStatus.CREATED)
  saveFromUrl(@Body() dto: CreateGalleryImageDto, @Req() req: Request & { user?: { id?: number } }) {
    const uploaderUserId = req.user?.id;
    if (!uploaderUserId) throw new BadRequestException('User not authenticated');
    return this.galleryService.saveImageFromUrl(dto, uploaderUserId);
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
