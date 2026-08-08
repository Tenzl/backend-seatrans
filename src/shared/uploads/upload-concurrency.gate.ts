import { HttpException, HttpStatus } from '@nestjs/common';
import { MULTIPART_UPLOAD_CONCURRENCY } from './upload-limits';

/**
 * Fail-fast semaphore for multipart uploads.
 * Queuing would still pin connections/memory; reject with 429 instead.
 */
export class UploadConcurrencyGate {
  private active = 0;

  constructor(private readonly maxConcurrent: number) {
    if (maxConcurrent < 1) {
      throw new Error('maxConcurrent must be >= 1');
    }
  }

  get inFlight(): number {
    return this.active;
  }

  get capacity(): number {
    return this.maxConcurrent;
  }

  tryAcquire(): boolean {
    if (this.active >= this.maxConcurrent) {
      return false;
    }
    this.active += 1;
    return true;
  }

  acquire(): void {
    if (!this.tryAcquire()) {
      throw new HttpException(
        {
          message: 'Too many concurrent uploads. Please retry shortly.',
          code: 'UPLOAD_CONCURRENCY_LIMIT',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  release(): void {
    if (this.active > 0) {
      this.active -= 1;
    }
  }
}

export const multipartUploadGate = new UploadConcurrencyGate(
  MULTIPART_UPLOAD_CONCURRENCY,
);
