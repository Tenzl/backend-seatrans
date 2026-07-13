import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
}

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
  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
    });
  }

  /**
   * Generate a signed Cloudinary URL for raw assets (e.g. PDFs) to prevent
   * long-lived public links from being shared.
   *
   * Note: This requires Cloudinary "Authenticated" delivery to be configured.
   * If not configured, fall back to the stored URL.
   */
  buildSignedRawUrl(publicId: string, expiresInSeconds = 60): string {
    if (!publicId?.trim()) return publicId;
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');
    if (!cloudName || !apiSecret) return publicId;

    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    try {
      // cloudinary.url signs using configured credentials (api_secret)
      return cloudinary.url(publicId, {
        resource_type: 'raw',
        type: 'authenticated',
        sign_url: true,
        expires_at: expiresAt,
        secure: true,
      });
    } catch {
      return publicId;
    }
  }

  async uploadBuffer(
    buffer: Buffer,
    folder = 'gallery',
  ): Promise<CloudinaryUploadResult> {
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image' },
        (error, uploadResult) => {
          if (error || !uploadResult) {
            reject(toError(error, 'Cloudinary upload failed'));
            return;
          }
          resolve(uploadResult);
        },
      );
      stream.end(buffer);
    }).catch((error: unknown) => {
      throw new InternalServerErrorException(
        `Cloudinary upload failed: ${toError(error, 'Unknown error').message}`,
      );
    });

    return {
      secureUrl: result.secure_url,
      publicId: result.public_id,
    };
  }

  async uploadRawBuffer(
    buffer: Buffer,
    folder = 'inquiries',
  ): Promise<CloudinaryUploadResult> {
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'raw' },
        (error, uploadResult) => {
          if (error || !uploadResult) {
            reject(toError(error, 'Cloudinary raw upload failed'));
            return;
          }
          resolve(uploadResult);
        },
      );
      stream.end(buffer);
    }).catch((error: unknown) => {
      throw new InternalServerErrorException(
        `Cloudinary raw upload failed: ${toError(error, 'Unknown error').message}`,
      );
    });

    return {
      secureUrl: result.secure_url,
      publicId: result.public_id,
    };
  }

  async deleteByPublicId(publicId: string): Promise<void> {
    if (!publicId) {
      return;
    }

    await cloudinary.uploader.destroy(publicId).catch((error: unknown) => {
      throw new InternalServerErrorException(
        `Cloudinary delete failed: ${toError(error, 'Unknown error').message}`,
      );
    });
  }
}
