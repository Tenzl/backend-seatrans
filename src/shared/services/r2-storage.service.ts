import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object,
  type CommonPrefix,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  assertSafeKey,
  assertSafeKeySegment,
  basename,
  folderKey,
  isFolderKey,
  joinKey,
  normalizePrefix,
  parentPrefixOf,
} from './storage-key.util';

export type StorageNodeType = 'folder' | 'file';

export interface StorageObjectDto {
  key: string;
  name: string;
  type: StorageNodeType;
  size?: number;
  contentType?: string;
  lastModified?: string;
  etag?: string;
}

export interface StorageListResultDto {
  prefix: string;
  parentPrefix: string | null;
  folders: StorageObjectDto[];
  files: StorageObjectDto[];
}

@Injectable()
export class R2StorageService {
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly configured: boolean;

  constructor(private readonly configService: ConfigService) {
    const accountId = this.configService.get<string>('R2_ACCOUNT_ID')?.trim();
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID')?.trim();
    const secretAccessKey = this.configService.get<string>('R2_SECRET_ACCESS_KEY')?.trim();
    this.bucket = this.configService.get<string>('R2_BUCKET_NAME')?.trim() ?? '';

    this.configured = !!(accountId && accessKeyId && secretAccessKey && this.bucket);

    if (this.configured) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
      });
    } else {
      this.client = null;
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  private requireClient(): S3Client {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException(
        'Object storage is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.',
      );
    }
    return this.client;
  }

  async list(prefix = ''): Promise<StorageListResultDto> {
    const client = this.requireClient();
    const normalized = normalizePrefix(prefix);

    const response = await client
      .send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: normalized || undefined,
          Delimiter: '/',
        }),
      )
      .catch((error) => {
        throw new InternalServerErrorException(`Failed to list storage: ${error?.message ?? error}`);
      });

    const folders = (response.CommonPrefixes ?? []).map((cp) => this.toFolderDto(cp, normalized));
    const files = (response.Contents ?? [])
      .filter((obj) => this.isImmediateFile(obj, normalized))
      .map((obj) => this.toFileDto(obj));

    return {
      prefix: normalized,
      parentPrefix: parentPrefixOf(normalized),
      folders,
      files,
    };
  }

  async createFolder(prefix: string, name: string): Promise<StorageObjectDto> {
    const client = this.requireClient();
    assertSafeKeySegment(name, 'name');
    const key = folderKey(prefix, name);
    assertSafeKey(key, 'key');

    await client
      .send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: Buffer.alloc(0),
          ContentType: 'application/x-directory',
        }),
      )
      .catch((error) => {
        throw new InternalServerErrorException(`Failed to create folder: ${error?.message ?? error}`);
      });

    return {
      key,
      name,
      type: 'folder',
      size: 0,
      lastModified: new Date().toISOString(),
    };
  }

  async upload(
    prefix: string,
    filename: string,
    buffer: Buffer,
    contentType?: string,
  ): Promise<StorageObjectDto> {
    const client = this.requireClient();
    assertSafeKeySegment(filename, 'filename');
    const key = joinKey(prefix, filename);
    assertSafeKey(key, 'key');

    const response = await client
      .send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType || 'application/octet-stream',
        }),
      )
      .catch((error) => {
        throw new InternalServerErrorException(`Failed to upload file: ${error?.message ?? error}`);
      });

    return {
      key,
      name: basename(key),
      type: 'file',
      size: buffer.length,
      contentType: contentType || 'application/octet-stream',
      lastModified: new Date().toISOString(),
      etag: response.ETag?.replace(/"/g, ''),
    };
  }

  async   rename(fromKey: string, toKey: string): Promise<StorageObjectDto> {
    const client = this.requireClient();
    assertSafeKey(fromKey, 'fromKey');
    assertSafeKey(toKey, 'toKey');

    const folderRename = isFolderKey(fromKey) || isFolderKey(toKey);
    const normalizedFrom = folderRename && !isFolderKey(fromKey) ? `${fromKey}/` : fromKey;
    const normalizedTo = folderRename && !isFolderKey(toKey) ? `${toKey}/` : toKey;

    if (isFolderKey(normalizedFrom) !== isFolderKey(normalizedTo)) {
      throw new BadRequestException('Cannot rename between file and folder types');
    }

    if (isFolderKey(normalizedFrom)) {
      await this.renameFolderPrefix(normalizedFrom, normalizedTo);
      return {
        key: normalizedTo,
        name: basename(normalizedTo.replace(/\/$/, '')),
        type: 'folder',
      };
    }

    await client
      .send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${normalizedFrom}`,
          Key: normalizedTo,
        }),
      )
      .catch((error) => {
        throw new InternalServerErrorException(`Failed to rename file: ${error?.message ?? error}`);
      });

    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: normalizedFrom }));

    return {
      key: normalizedTo,
      name: basename(normalizedTo),
      type: 'file',
    };
  }

  async delete(key: string): Promise<void> {
    const client = this.requireClient();
    assertSafeKey(key, 'key');

    if (isFolderKey(key)) {
      await this.deleteFolderRecursive(key);
      return;
    }

    await client
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
      .catch((error) => {
        throw new InternalServerErrorException(`Failed to delete object: ${error?.message ?? error}`);
      });
  }

  async getDownloadUrl(key: string, expiresInSeconds = 3600): Promise<{ url: string; expiresAt: string }> {
    const client = this.requireClient();
    assertSafeKey(key, 'key');
    if (isFolderKey(key)) {
      throw new BadRequestException('Cannot download a folder');
    }

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    ).catch((error) => {
      throw new InternalServerErrorException(`Failed to create download URL: ${error?.message ?? error}`);
    });

    return { url, expiresAt };
  }

  private isImmediateFile(obj: _Object, prefix: string): boolean {
    if (!obj.Key || obj.Key === prefix) return false;
    if (isFolderKey(obj.Key)) return false;
    const relative = prefix ? obj.Key.slice(prefix.length) : obj.Key;
    return !relative.includes('/');
  }

  private toFolderDto(cp: CommonPrefix, prefix: string): StorageObjectDto {
    const key = cp.Prefix ?? '';
    const name = prefix ? key.slice(prefix.length).replace(/\/$/, '') : key.replace(/\/$/, '');
    return { key, name, type: 'folder' };
  }

  private toFileDto(obj: _Object): StorageObjectDto {
    return {
      key: obj.Key!,
      name: basename(obj.Key!),
      type: 'file',
      size: obj.Size,
      lastModified: obj.LastModified?.toISOString(),
      etag: obj.ETag?.replace(/"/g, ''),
    };
  }

  private async deleteFolderRecursive(prefix: string): Promise<void> {
    const client = this.requireClient();
    let continuationToken: string | undefined;

    do {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      const keys = (listed.Contents ?? [])
        .map((obj) => obj.Key)
        .filter((k): k is string => !!k);

      if (keys.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }

      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  private async renameFolderPrefix(fromPrefix: string, toPrefix: string): Promise<void> {
    const client = this.requireClient();
    let continuationToken: string | undefined;

    do {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: fromPrefix,
          ContinuationToken: continuationToken,
        }),
      );

      for (const obj of listed.Contents ?? []) {
        if (!obj.Key) continue;
        const relative = obj.Key.slice(fromPrefix.length);
        const destKey = `${toPrefix}${relative}`;

        await client.send(
          new CopyObjectCommand({
            Bucket: this.bucket,
            CopySource: `${this.bucket}/${obj.Key}`,
            Key: destKey,
          }),
        );
        await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: obj.Key }));
      }

      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
  }
}
