import { PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createWriteStream, mkdirSync, unlink } from 'fs';
import type { Request } from 'express';
import type { StorageEngine } from 'multer';
import { join } from 'path';
import { tmpdir } from 'os';

const TOTAL_BYTES_KEY = '__seatransUploadTotalBytes';

type TrackingRequest = Request & {
  [TOTAL_BYTES_KEY]?: number;
};

export interface BoundedDiskStorageOptions {
  maxTotalBytes: number;
  /** Defaults to `<os.tmpdir()>/seatrans-uploads`. */
  destination?: string;
}

/**
 * Multer disk storage that enforces an aggregate byte budget across all files
 * in the same request (Multer's `limits.fileSize` is per-file only).
 */
export function createBoundedDiskStorage(
  options: BoundedDiskStorageOptions,
): StorageEngine {
  const destination =
    options.destination ?? join(tmpdir(), 'seatrans-uploads');
  mkdirSync(destination, { recursive: true });

  return {
    _handleFile(req: TrackingRequest, file, cb) {
      let total = req[TOTAL_BYTES_KEY] ?? 0;
      if (total >= options.maxTotalBytes) {
        cb(
          new PayloadTooLargeException(
            `Total upload size exceeds ${options.maxTotalBytes} bytes`,
          ),
        );
        return;
      }

      const filename = `${Date.now()}-${randomUUID()}`;
      const path = join(destination, filename);
      const out = createWriteStream(path);
      let fileSize = 0;
      let settled = false;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        file.stream.destroy();
        out.destroy();
        unlink(path, () => undefined);
        cb(error);
      };

      file.stream.on('data', (chunk: Buffer | string) => {
        const size = Buffer.isBuffer(chunk)
          ? chunk.length
          : Buffer.byteLength(chunk);
        fileSize += size;
        total += size;
        req[TOTAL_BYTES_KEY] = total;

        if (total > options.maxTotalBytes) {
          fail(
            new PayloadTooLargeException(
              `Total upload size exceeds ${options.maxTotalBytes} bytes`,
            ),
          );
        }
      });

      file.stream.on('error', (error: Error) => fail(error));
      out.on('error', (error: Error) => fail(error));
      out.on('finish', () => {
        if (settled) return;
        settled = true;
        cb(null, {
          destination,
          filename,
          path,
          size: fileSize,
        });
      });

      file.stream.pipe(out);
    },

    _removeFile(_req, file, cb) {
      if (!file.path) {
        cb(null);
        return;
      }
      unlink(file.path, () => cb(null));
    },
  };
}
