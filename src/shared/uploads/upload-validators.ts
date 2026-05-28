import { BadRequestException } from '@nestjs/common';

export const MB = 1024 * 1024;

export function allowMimeTypes(allowed: string[]) {
  const allow = new Set(allowed.map((t) => t.toLowerCase()));
  return (_req: any, file: Express.Multer.File, cb: (error: any, acceptFile: boolean) => void) => {
    const mime = String(file?.mimetype ?? '').toLowerCase();
    if (!mime || !allow.has(mime)) {
      return cb(new BadRequestException('Invalid file type'), false);
    }
    return cb(null, true);
  };
}

