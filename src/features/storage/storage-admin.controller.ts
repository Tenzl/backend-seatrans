import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminSection } from '../../shared/decorators/admin-section.decorator';
import { PermanentDelete } from '../../shared/decorators/permanent-delete.decorator';
import { StorageService } from './storage.service';
import { StorageListQueryDto } from './dto/storage-list-query.dto';
import { CreateFolderDto } from './dto/create-folder.dto';
import { RenameStorageDto } from './dto/rename-storage.dto';
import { StorageKeyQueryDto } from './dto/storage-key-query.dto';
import { STORAGE_UPLOAD_LIMITS } from '../../shared/uploads/upload-limits';
import { buildMultipartUploadOptions } from '../../shared/uploads/multipart-upload.options';
import { UploadConcurrencyInterceptor } from '../../shared/uploads/upload-concurrency.interceptor';
import { CleanupUploadedFilesInterceptor } from '../../shared/uploads/cleanup-uploaded-files.interceptor';

@AdminSection('data-storage')
@Controller('v1/admin/storage')
export class StorageAdminController {
  constructor(private readonly storageService: StorageService) {}

  @Get()
  list(@Query() query: StorageListQueryDto) {
    return this.storageService.list(query.prefix);
  }

  @Get('download-url')
  downloadUrl(@Query() query: StorageKeyQueryDto) {
    return this.storageService.getDownloadUrl(query.key);
  }

  @Post('folders')
  @HttpCode(HttpStatus.CREATED)
  createFolder(@Body() dto: CreateFolderDto) {
    return this.storageService.createFolder(dto.prefix, dto.name);
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    UploadConcurrencyInterceptor,
    CleanupUploadedFilesInterceptor,
    FileInterceptor(
      'file',
      buildMultipartUploadOptions({
        maxFileSize: STORAGE_UPLOAD_LIMITS.maxFileSize,
        maxFiles: STORAGE_UPLOAD_LIMITS.maxFiles,
        maxTotalBytes: STORAGE_UPLOAD_LIMITS.maxTotalBytes,
      }),
    ),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('prefix') prefix?: string,
    @Query('filename') filename?: string,
  ) {
    const resolvedName = (filename || file?.originalname || '').trim();
    if (!resolvedName) {
      throw new BadRequestException('filename is required');
    }
    return this.storageService.upload(prefix, resolvedName, file);
  }

  @Put('rename')
  rename(@Body() dto: RenameStorageDto) {
    return this.storageService.rename(dto.fromKey, dto.toKey);
  }

  @Delete()
  @PermanentDelete({
    resourceType: 'storage_object',
    idSource: { kind: 'query', key: 'key' },
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Query() query: StorageKeyQueryDto) {
    await this.storageService.delete(query.key);
  }
}
