import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { cleanupUploadedFiles } from './uploaded-file.util';

type MulterRequest = Request & {
  file?: Express.Multer.File;
  files?:
    | Express.Multer.File[]
    | Record<string, Express.Multer.File[] | undefined>;
};

@Injectable()
export class CleanupUploadedFilesInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<MulterRequest>();
    return next.handle().pipe(
      finalize(() => {
        void cleanupUploadedFiles(collectFiles(req));
      }),
    );
  }
}

function collectFiles(req: MulterRequest): Express.Multer.File[] {
  const out: Express.Multer.File[] = [];
  if (req.file) out.push(req.file);

  if (Array.isArray(req.files)) {
    out.push(...req.files);
  } else if (req.files && typeof req.files === 'object') {
    for (const group of Object.values(req.files)) {
      if (Array.isArray(group)) out.push(...group);
    }
  }
  return out;
}
