import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { multipartUploadGate } from './upload-concurrency.gate';

/**
 * Acquire the process-wide upload slot before Multer parses the body
 * (FileInterceptor runs inside nested interceptors).
 */
@Injectable()
export class UploadConcurrencyInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    multipartUploadGate.acquire();
    return next.handle().pipe(finalize(() => multipartUploadGate.release()));
  }
}
