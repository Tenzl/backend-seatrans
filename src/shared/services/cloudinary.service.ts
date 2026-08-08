import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import {
  openUploadedFileStream,
  type UploadedFileLike,
} from '../uploads/uploaded-file.util';
import { readPositiveInt } from '../utils/env-int';
import { TimeoutError, withTimeout } from '../utils/with-timeout';

export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
}

export type CloudinaryResourceType = 'image' | 'raw';

/** Default Cloudinary upload/delete deadline (ms). Override via CLOUDINARY_TIMEOUT_MS. */
const DEFAULT_CLOUDINARY_TIMEOUT_MS = 60_000;

function toError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return new Error(error.message);
  }

  return new Error(fallbackMessage);
}

@Injectable()
export class CloudinaryService {
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
    });
    this.timeoutMs = readPositiveInt(
      this.configService.get<string>('CLOUDINARY_TIMEOUT_MS'),
      DEFAULT_CLOUDINARY_TIMEOUT_MS,
      { min: 1_000, max: 300_000 },
    );
  }

  /**
   * Generate a signed Cloudinary URL for raw assets (e.g. PDFs) to prevent
   * long-lived public links from being shared.
   *
   * Note: This requires Cloudinary "Authenticated" delivery to be configured.
   * If not configured, fall back to the stored URL.
   *
   * When `attachmentFilename` is set, Cloudinary's `fl_attachment` forces
   * Content-Disposition: attachment on the delivered object (SEC-03).
   */
  buildSignedRawUrl(
    publicId: string,
    expiresInSeconds = 60,
    attachmentFilename?: string,
  ): string {
    if (!publicId?.trim()) return publicId;
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');
    if (!cloudName || !apiSecret) return publicId;

    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    try {
      const flags = attachmentFilename?.trim()
        ? `attachment:${attachmentFilename.trim().replace(/[/\\?%*:|"<>]/g, '_').slice(0, 120)}`
        : undefined;
      // cloudinary.url signs using configured credentials (api_secret)
      return cloudinary.url(publicId, {
        resource_type: 'raw',
        type: 'authenticated',
        sign_url: true,
        expires_at: expiresAt,
        secure: true,
        ...(flags ? { flags } : {}),
      });
    } catch {
      return publicId;
    }
  }

  async uploadBuffer(
    buffer: Buffer,
    folder = 'gallery',
  ): Promise<CloudinaryUploadResult> {
    return this.uploadImage({ buffer }, folder);
  }

  async uploadImage(
    file: UploadedFileLike,
    folder = 'gallery',
  ): Promise<CloudinaryUploadResult> {
    return this.pipeUpload(file, folder, 'image', 'Cloudinary upload failed');
  }

  async uploadRawBuffer(
    buffer: Buffer,
    folder = 'inquiries',
  ): Promise<CloudinaryUploadResult> {
    return this.uploadRaw({ buffer }, folder);
  }

  async uploadRaw(
    file: UploadedFileLike,
    folder = 'inquiries',
  ): Promise<CloudinaryUploadResult> {
    return this.pipeUpload(
      file,
      folder,
      'raw',
      'Cloudinary raw upload failed',
    );
  }

  private async pipeUpload(
    file: UploadedFileLike,
    folder: string,
    resourceType: CloudinaryResourceType,
    failureLabel: string,
  ): Promise<CloudinaryUploadResult> {
    let uploadStream: ReturnType<typeof cloudinary.uploader.upload_stream> | undefined;
    let source: ReturnType<typeof openUploadedFileStream> | undefined;

    const uploadPromise = new Promise<UploadApiResponse>((resolve, reject) => {
      uploadStream = cloudinary.uploader.upload_stream(
        { folder, resource_type: resourceType },
        (error, uploadResult) => {
          if (error || !uploadResult) {
            reject(toError(error, failureLabel));
            return;
          }
          resolve(uploadResult);
        },
      );

      source = openUploadedFileStream(file);
      source.on('error', (error: Error) => {
        uploadStream?.destroy(error);
        reject(error);
      });
      source.pipe(uploadStream);
    });

    try {
      const result = await withTimeout(
        uploadPromise,
        this.timeoutMs,
        failureLabel,
        () => {
          source?.destroy();
          uploadStream?.destroy(new Error(`${failureLabel} aborted`));
        },
      );

      return {
        secureUrl: result.secure_url,
        publicId: result.public_id,
      };
    } catch (error: unknown) {
      if (error instanceof TimeoutError) {
        throw new InternalServerErrorException(error.message);
      }
      throw new InternalServerErrorException(
        `${failureLabel}: ${toError(error, 'Unknown error').message}`,
      );
    }
  }

  async deleteByPublicId(
    publicId: string,
    resourceType: CloudinaryResourceType = 'image',
  ): Promise<void> {
    if (!publicId) {
      return;
    }

    try {
      await withTimeout(
        cloudinary.uploader.destroy(publicId, {
          resource_type: resourceType,
        }),
        this.timeoutMs,
        'Cloudinary delete',
      );
    } catch (error: unknown) {
      if (error instanceof TimeoutError) {
        throw new InternalServerErrorException(error.message);
      }
      throw new InternalServerErrorException(
        `Cloudinary delete failed: ${toError(error, 'Unknown error').message}`,
      );
    }
  }
}
