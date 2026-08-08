import { BadRequestException } from '@nestjs/common';
import { extname } from 'path';
import { open } from 'fs/promises';
import {
  hasUploadedContent,
  readUploadedFileBuffer,
  type UploadedFileLike,
} from './uploaded-file.util';

/** Default inquiry attachment allowlist (code-defined; not env-driven). */
export const INQUIRY_ATTACHMENT_TYPES = [
  {
    extensions: ['.pdf'],
    mimes: ['application/pdf'],
    kind: 'pdf' as const,
  },
  {
    extensions: ['.jpg', '.jpeg'],
    mimes: ['image/jpeg'],
    kind: 'jpeg' as const,
  },
  {
    extensions: ['.png'],
    mimes: ['image/png'],
    kind: 'png' as const,
  },
  {
    extensions: ['.doc'],
    mimes: ['application/msword'],
    kind: 'ole' as const,
  },
  {
    extensions: ['.docx'],
    mimes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/zip',
    ],
    kind: 'zip' as const,
  },
] as const;

export type InquiryAttachmentKind =
  (typeof INQUIRY_ATTACHMENT_TYPES)[number]['kind'];

export type DetectedInquiryAttachment = {
  extension: string;
  mimeType: string;
  kind: InquiryAttachmentKind;
};

const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set(
  INQUIRY_ATTACHMENT_TYPES.flatMap((entry) => [...entry.extensions]),
);

function normalizeExtension(originalname: string | undefined): string {
  const ext = extname(String(originalname ?? ''))
    .trim()
    .toLowerCase();
  return ext;
}

function startsWithBytes(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
}

function detectKindFromMagic(buffer: Buffer): InquiryAttachmentKind | null {
  // PDF: "%PDF"
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return 'pdf';
  }
  // JPEG
  if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) {
    return 'jpeg';
  }
  // PNG
  if (
    startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return 'png';
  }
  // Legacy OLE Compound Document (.doc)
  if (
    startsWithBytes(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  ) {
    return 'ole';
  }
  // ZIP container (.docx and other OOXML)
  if (startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    return 'zip';
  }
  return null;
}

function entryForExtension(extension: string) {
  return INQUIRY_ATTACHMENT_TYPES.find((entry) =>
    (entry.extensions as readonly string[]).includes(extension),
  );
}

function entryForKind(kind: InquiryAttachmentKind) {
  return INQUIRY_ATTACHMENT_TYPES.find((entry) => entry.kind === kind);
}

/**
 * Multer fileFilter: extension allowlist only.
 * Client Content-Type is not trusted; magic bytes are checked after buffering.
 */
export function inquiryAttachmentFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
): void {
  // JSON inquiry payload part — not an attachment.
  if (file.fieldname === 'inquiry') {
    const mime = String(file.mimetype ?? '').toLowerCase();
    if (
      mime &&
      mime !== 'application/json' &&
      mime !== 'text/plain' &&
      mime !== 'application/octet-stream'
    ) {
      return cb(new BadRequestException('Invalid inquiry payload type'), false);
    }
    return cb(null, true);
  }

  const extension = normalizeExtension(file.originalname);
  if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
    return cb(
      new BadRequestException(
        'Invalid file type. Allowed: PDF, JPG, PNG, DOC, DOCX',
      ),
      false,
    );
  }
  return cb(null, true);
}

/**
 * Defense-in-depth: extension + magic bytes. Never trusts client mimetype alone.
 * Returns the canonical MIME derived from content + extension agreement.
 */
export async function assertInquiryAttachmentSafe(
  file: UploadedFileLike,
): Promise<DetectedInquiryAttachment> {
  if (!hasUploadedContent(file)) {
    throw new BadRequestException('file is required');
  }

  const extension = normalizeExtension(file.originalname);
  const byExtension = entryForExtension(extension);
  if (!byExtension) {
    throw new BadRequestException(
      'Invalid file type. Allowed: PDF, JPG, PNG, DOC, DOCX',
    );
  }

  // Read only the header for magic-byte checks (files may be large on disk).
  let header: Buffer;
  if (file.buffer?.length) {
    header = file.buffer.subarray(0, 16);
  } else if (file.path) {
    const handle = await open(file.path, 'r');
    try {
      const buf = Buffer.alloc(16);
      const { bytesRead } = await handle.read(buf, 0, 16, 0);
      header = buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } else {
    header = (await readUploadedFileBuffer(file)).subarray(0, 16);
  }

  const magicKind = detectKindFromMagic(header);
  if (!magicKind) {
    throw new BadRequestException(
      'File content does not match an allowed type',
    );
  }

  if (magicKind !== byExtension.kind) {
    throw new BadRequestException(
      'File extension does not match file content',
    );
  }

  const byKind = entryForKind(magicKind);
  if (!byKind) {
    throw new BadRequestException(
      'File content does not match an allowed type',
    );
  }

  // Prefer canonical MIME for the extension; never store a spoofed client type.
  return {
    extension,
    mimeType: byKind.mimes[0],
    kind: magicKind,
  };
}

/** Strip path separators / quotes for Content-Disposition filenames. */
export function sanitizeAttachmentFilename(name: string | null | undefined): string {
  const base = String(name ?? 'download')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/[\r\n\0]/g, '')
    .trim();
  return base.slice(0, 180) || 'download';
}
