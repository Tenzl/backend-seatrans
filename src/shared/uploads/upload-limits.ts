import { MB } from './upload-validators';

/** Process-wide cap on concurrent multipart upload requests. */
export const MULTIPART_UPLOAD_CONCURRENCY = 4;

/**
 * Gallery batch used to allow 30 × 10MB (~300MB) fully buffered in memory.
 * Keep per-file at 10MB (admin UI) but cap count + aggregate payload.
 */
export const GALLERY_UPLOAD_LIMITS = {
  maxFileSize: 10 * MB,
  maxFiles: 20,
  maxTotalBytes: 40 * MB,
} as const;

/** Single gallery image upload. */
export const GALLERY_SINGLE_UPLOAD_LIMITS = {
  maxFileSize: 10 * MB,
  maxFiles: 1,
  maxTotalBytes: 10 * MB,
} as const;

/**
 * Storage proxy: disk-backed so a 100MB ceiling does not spike RSS.
 */
export const STORAGE_UPLOAD_LIMITS = {
  maxFileSize: 100 * MB,
  maxFiles: 1,
  maxTotalBytes: 100 * MB,
} as const;

/**
 * Public inquiry: 1 JSON part + up to 10 attachments.
 * FE contact form uses 5MB × 10; keep headroom without 11 × 12MB memory spikes.
 */
export const INQUIRY_UPLOAD_LIMITS = {
  maxFileSize: 8 * MB,
  maxFiles: 11,
  maxAttachmentFiles: 10,
  maxTotalBytes: 52 * MB,
} as const;
