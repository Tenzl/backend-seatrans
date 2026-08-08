import { HttpException, HttpStatus, PayloadTooLargeException } from '@nestjs/common';
import { Readable } from 'stream';
import { promises as fs } from 'fs';
import { UploadConcurrencyGate } from './upload-concurrency.gate';
import { createBoundedDiskStorage } from './bounded-disk.storage';
import {
  GALLERY_UPLOAD_LIMITS,
  INQUIRY_UPLOAD_LIMITS,
  MULTIPART_UPLOAD_CONCURRENCY,
  STORAGE_UPLOAD_LIMITS,
} from './upload-limits';
import {
  cleanupUploadedFiles,
  hashUploadedFile,
  readUploadedFileBuffer,
} from './uploaded-file.util';
import { join } from 'path';
import { tmpdir } from 'os';

describe('PERF-01 multipart upload protection', () => {
  describe('limits', () => {
    it('keeps aggregate budgets well below previous memory ceilings', () => {
      expect(GALLERY_UPLOAD_LIMITS.maxFiles).toBeLessThanOrEqual(20);
      expect(GALLERY_UPLOAD_LIMITS.maxTotalBytes).toBeLessThanOrEqual(40 * 1024 * 1024);
      expect(
        GALLERY_UPLOAD_LIMITS.maxFileSize * GALLERY_UPLOAD_LIMITS.maxFiles,
      ).toBeGreaterThan(GALLERY_UPLOAD_LIMITS.maxTotalBytes);

      // Disk-backed storage may accept larger single files than in-memory gallery.
      expect(STORAGE_UPLOAD_LIMITS.maxFileSize).toBe(100 * 1024 * 1024);
      expect(STORAGE_UPLOAD_LIMITS.maxTotalBytes).toBe(100 * 1024 * 1024);
      expect(INQUIRY_UPLOAD_LIMITS.maxFileSize).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(INQUIRY_UPLOAD_LIMITS.maxTotalBytes).toBeLessThanOrEqual(52 * 1024 * 1024);
      expect(MULTIPART_UPLOAD_CONCURRENCY).toBe(4);
    });
  });

  describe('UploadConcurrencyGate', () => {
    it('allows up to maxConcurrent acquires then rejects with 429', () => {
      const gate = new UploadConcurrencyGate(2);
      gate.acquire();
      gate.acquire();
      expect(gate.inFlight).toBe(2);

      try {
        gate.acquire();
        fail('expected 429');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      gate.release();
      expect(gate.inFlight).toBe(1);
      gate.acquire();
      expect(gate.inFlight).toBe(2);
      gate.release();
      gate.release();
      expect(gate.inFlight).toBe(0);
    });
  });

  describe('createBoundedDiskStorage', () => {
    it('rejects when aggregate bytes exceed the request budget', async () => {
      const destination = join(tmpdir(), `seatrans-upload-test-${Date.now()}`);
      await fs.mkdir(destination, { recursive: true });
      const storage = createBoundedDiskStorage({
        maxTotalBytes: 8,
        destination,
      });

      const req = {} as any;
      const first = await handleFile(
        storage,
        req,
        Readable.from([Buffer.from('12345')]),
      );
      expect(first.size).toBe(5);
      expect(first.path).toBeTruthy();

      await expect(
        handleFile(storage, req, Readable.from([Buffer.from('abcdef')])),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);

      await cleanupUploadedFiles([first]);
      await fs.rm(destination, { recursive: true, force: true });
    });
  });

  describe('uploaded-file.util', () => {
    it('reads and hashes disk-backed uploads', async () => {
      const path = join(tmpdir(), `seatrans-hash-${Date.now()}.bin`);
      await fs.writeFile(path, Buffer.from('hello-upload'));
      const file = { path, size: 12 };

      await expect(readUploadedFileBuffer(file)).resolves.toEqual(
        Buffer.from('hello-upload'),
      );
      await expect(hashUploadedFile(file)).resolves.toMatch(/^[a-f0-9]{64}$/);
      await cleanupUploadedFiles([file]);
      await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });
});

function handleFile(
  storage: ReturnType<typeof createBoundedDiskStorage>,
  req: object,
  stream: Readable,
): Promise<{ path?: string; size?: number }> {
  return new Promise((resolve, reject) => {
    storage._handleFile(
      req as any,
      {
        fieldname: 'files',
        originalname: 'a.bin',
        encoding: '7bit',
        mimetype: 'application/octet-stream',
        stream,
      } as any,
      (error: any, info?: any) => {
        if (error) reject(error);
        else resolve(info ?? {});
      },
    );
  });
}
