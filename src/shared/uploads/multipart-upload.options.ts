import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { createBoundedDiskStorage } from './bounded-disk.storage';

export interface MultipartUploadOptionsInput {
  maxFileSize: number;
  maxFiles: number;
  maxTotalBytes: number;
  fileFilter?: MulterOptions['fileFilter'];
}

/** Shared Multer options: disk-backed + per-file + aggregate limits. */
export function buildMultipartUploadOptions(
  input: MultipartUploadOptionsInput,
): MulterOptions {
  return {
    storage: createBoundedDiskStorage({
      maxTotalBytes: input.maxTotalBytes,
    }),
    limits: {
      fileSize: input.maxFileSize,
      files: input.maxFiles,
    },
    ...(input.fileFilter ? { fileFilter: input.fileFilter } : {}),
  };
}
