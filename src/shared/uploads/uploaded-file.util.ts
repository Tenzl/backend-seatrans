import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import { Readable } from 'stream';

export type UploadedFileLike = {
  buffer?: Buffer;
  path?: string;
  size?: number;
  originalname?: string;
  mimetype?: string;
};

export function hasUploadedContent(file?: UploadedFileLike | null): boolean {
  if (!file) return false;
  if (file.buffer && file.buffer.length > 0) return true;
  if (file.path) return true;
  return false;
}

/** Prefer streaming when the file lives on disk (diskStorage). */
export function openUploadedFileStream(file: UploadedFileLike): Readable {
  if (file.path) {
    return createReadStream(file.path);
  }
  if (file.buffer?.length) {
    return Readable.from(file.buffer);
  }
  throw new BadRequestException('File is required');
}

export async function readUploadedFileBuffer(
  file: UploadedFileLike,
): Promise<Buffer> {
  if (file.buffer?.length) {
    return file.buffer;
  }
  if (file.path) {
    return fs.readFile(file.path);
  }
  throw new BadRequestException('File is required');
}

export async function hashUploadedFile(
  file: UploadedFileLike,
): Promise<string> {
  if (file.buffer?.length) {
    return createHash('sha256').update(file.buffer).digest('hex');
  }
  if (!file.path) {
    throw new BadRequestException('File is required');
  }

  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file.path!);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function cleanupUploadedFiles(
  files: Array<UploadedFileLike | null | undefined>,
): Promise<void> {
  return Promise.all(
    files.map(async (file) => {
      if (!file?.path) return;
      await fs.unlink(file.path).catch(() => undefined);
    }),
  ).then(() => undefined);
}
