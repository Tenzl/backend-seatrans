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
import { AdminSection } from '../../shared/decorators/admin-section.decorator';
import { PermanentDelete } from '../../shared/decorators/permanent-delete.decorator';
import { GalleryService } from './gallery.service';
import { CreateGalleryImageDto } from './dto/create-gallery-image.dto';
import { UpdateGalleryImageDto } from './dto/update-gallery-image.dto';
import { GalleryListQueryDto } from './dto/gallery-list-query.dto';
import { GalleryCountsQueryDto } from './dto/gallery-counts-query.dto';
import { GalleryMultipartFieldsDto } from './dto/gallery-multipart-fields.dto';
import { validateDto } from '../../shared/utils/validate-dto.util';
import { allowMimeTypes } from '../../shared/uploads/upload-validators';
import {
  GALLERY_SINGLE_UPLOAD_LIMITS,
  GALLERY_UPLOAD_LIMITS,
} from '../../shared/uploads/upload-limits';
import { buildMultipartUploadOptions } from '../../shared/uploads/multipart-upload.options';
import { UploadConcurrencyInterceptor } from '../../shared/uploads/upload-concurrency.interceptor';
import { CleanupUploadedFilesInterceptor } from '../../shared/uploads/cleanup-uploaded-files.interceptor';

@AdminSection('data-images')
@Controller('v1/admin/gallery-images')
export class GalleryAdminController {
  constructor(private readonly galleryService: GalleryService) {}

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    UploadConcurrencyInterceptor,
    CleanupUploadedFilesInterceptor,
    FilesInterceptor(
      'files',
      GALLERY_UPLOAD_LIMITS.maxFiles,
      buildMultipartUploadOptions({
        maxFileSize: GALLERY_UPLOAD_LIMITS.maxFileSize,
        maxFiles: GALLERY_UPLOAD_LIMITS.maxFiles,
        maxTotalBytes: GALLERY_UPLOAD_LIMITS.maxTotalBytes,
        fileFilter: allowMimeTypes(['image/jpeg', 'image/png', 'image/webp']),
      }),
    ),
  )
  async uploadBatch(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: Record<string, unknown>,
    @Req() req: Request & { user?: { id?: number } },
  ) {
    const fields = await validateDto(GalleryMultipartFieldsDto, body);
    const uploaderUserId = req.user?.id;
    if (!uploaderUserId)
      throw new BadRequestException('User not authenticated');
    return this.galleryService.uploadMultiple(
      files,
      fields.toCreateDto(),
      uploaderUserId,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    UploadConcurrencyInterceptor,
    CleanupUploadedFilesInterceptor,
    FileInterceptor(
      'file',
      buildMultipartUploadOptions({
        maxFileSize: GALLERY_SINGLE_UPLOAD_LIMITS.maxFileSize,
        maxFiles: GALLERY_SINGLE_UPLOAD_LIMITS.maxFiles,
        maxTotalBytes: GALLERY_SINGLE_UPLOAD_LIMITS.maxTotalBytes,
        fileFilter: allowMimeTypes(['image/jpeg', 'image/png', 'image/webp']),
      }),
    ),
  )
  async uploadSingle(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
    @Req() req: Request & { user?: { id?: number } },
  ) {
    // Metadata can arrive via query string (preferred — survives a same-origin
    // reverse proxy that strips multipart text fields) or the multipart body.
    // Parse explicitly: the class-transformer @Transform + implicit-conversion
    // combo mis-handled the snake_case keys, so we coerce to numbers here.
    const src = { ...body, ...query } as Record<string, unknown>;
    const parseId = (camel: string, snake: string): number =>
      Number(src[camel] ?? src[snake]);
    const dto: CreateGalleryImageDto = {
      provinceId: parseId('provinceId', 'province_id'),
      portId: parseId('portId', 'port_id'),
      serviceTypeId: parseId('serviceTypeId', 'service_type_id'),
      commodityId: parseId('commodityId', 'commodity_id'),
    };
    const invalid = Object.entries(dto)
      .filter(([, v]) => !Number.isInteger(v) || v < 1)
      .map(([field]) => ({
        field,
        message: `${field} must be a positive integer`,
      }));
    if (invalid.length) {
      throw new BadRequestException({
        message: 'Request validation failed',
        details: invalid,
      });
    }
    const uploaderUserId = req.user?.id;
    if (!uploaderUserId)
      throw new BadRequestException('User not authenticated');
    return this.galleryService.uploadSingle(file, dto, uploaderUserId);
  }

  @Post('from-url')
  @HttpCode(HttpStatus.CREATED)
  saveFromUrl(
    @Body() dto: CreateGalleryImageDto,
    @Req() req: Request & { user?: { id?: number } },
  ) {
    const uploaderUserId = req.user?.id;
    if (!uploaderUserId)
      throw new BadRequestException('User not authenticated');
    return this.galleryService.saveImageFromUrl(dto, uploaderUserId);
  }

  @Get()
  list(@Query() query: GalleryListQueryDto) {
    if (query.unpaged) {
      return this.galleryService.getAdminImagesAll(query.size);
    }
    return this.galleryService.getAdminImages(query);
  }

  /** Aggregate image counts by commodity — must stay before `:id`. */
  @Get('counts')
  getCounts(@Query() query: GalleryCountsQueryDto) {
    return this.galleryService.getCommodityCounts(query);
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
  @PermanentDelete({
    resourceType: 'gallery_image',
    idSource: { kind: 'param', key: 'id' },
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.galleryService.delete(Number(id));
  }
}
