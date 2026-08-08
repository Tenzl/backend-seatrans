import { BadRequestException, Injectable } from '@nestjs/common';
import { R2StorageService } from '../../shared/services/r2-storage.service';
import { assertSafeKey } from '../../shared/services/storage-key.util';
import { hasUploadedContent } from '../../shared/uploads/uploaded-file.util';

@Injectable()
export class StorageService {
  constructor(private readonly r2: R2StorageService) {}

  list(prefix?: string) {
    return this.r2.list(prefix);
  }

  createFolder(prefix: string | undefined, name: string) {
    try {
      return this.r2.createFolder(prefix ?? '', name);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  upload(
    prefix: string | undefined,
    filename: string,
    file: Express.Multer.File,
  ) {
    if (!hasUploadedContent(file)) {
      throw new BadRequestException('File is required');
    }
    try {
      return this.r2.uploadFile(
        prefix ?? '',
        filename,
        file,
        file.mimetype,
      );
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  rename(fromKey: string, toKey: string) {
    try {
      assertSafeKey(fromKey, 'fromKey');
      assertSafeKey(toKey, 'toKey');
      return this.r2.rename(fromKey, toKey);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  delete(key: string) {
    try {
      assertSafeKey(key, 'key');
      return this.r2.delete(key);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  getDownloadUrl(key: string) {
    try {
      assertSafeKey(key, 'key');
      return this.r2.getDownloadUrl(key);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
}
