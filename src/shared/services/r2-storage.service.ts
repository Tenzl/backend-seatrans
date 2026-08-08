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
import { NodeHttpHandler } from '@smithy/node-http-handler';
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
import {
  hasUploadedContent,
  openUploadedFileStream,
  type UploadedFileLike,
} from '../uploads/uploaded-file.util';
import type { Readable } from 'stream';
import { abortSignalAfter } from '../utils/with-timeout';
import { readPositiveInt } from '../utils/env-int';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

export interface StorageFolderMutationResultDto extends StorageObjectDto {
  objectCount: number;
  warning?: string;
}

/** Sync folder rename/delete hard cap — larger trees need split or a future async job. */
const DEFAULT_FOLDER_SYNC_MAX_OBJECTS = 250;
const DEFAULT_R2_TIMEOUT_MS = 30_000;
const FOLDER_WARN_RATIO = 0.8;

@Injectable()
export class R2StorageService {
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly configured: boolean;
  private readonly requestTimeoutMs: number;
  private readonly folderSyncMaxObjects: number;

  constructor(private readonly configService: ConfigService) {
    const accountId = this.configService.get<string>('R2_ACCOUNT_ID')?.trim();
    const accessKeyId = this.configService
      .get<string>('R2_ACCESS_KEY_ID')
      ?.trim();
    const secretAccessKey = this.configService
      .get<string>('R2_SECRET_ACCESS_KEY')
      ?.trim();
    this.bucket =
      this.configService.get<string>('R2_BUCKET_NAME')?.trim() ?? '';

    this.requestTimeoutMs = readPositiveInt(
      this.configService.get<string>('R2_REQUEST_TIMEOUT_MS'),
      DEFAULT_R2_TIMEOUT_MS,
      { min: 1_000, max: 120_000 },
    );
    this.folderSyncMaxObjects = readPositiveInt(
      this.configService.get<string>('R2_FOLDER_SYNC_MAX_OBJECTS'),
      DEFAULT_FOLDER_SYNC_MAX_OBJECTS,
      { min: 1, max: 5_000 },
    );

    this.configured = !!(
      accountId &&
      accessKeyId &&
      secretAccessKey &&
      this.bucket
    );

    if (this.configured) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: accessKeyId!,
          secretAccessKey: secretAccessKey!,
        },
        requestHandler: new NodeHttpHandler({
          connectionTimeout: this.requestTimeoutMs,
          requestTimeout: this.requestTimeoutMs,
        }),
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

  private abortSignal() {
    return abortSignalAfter(this.requestTimeoutMs);
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
        { abortSignal: this.abortSignal() },
      )
      .catch((error: unknown) => {
        throw new InternalServerErrorException(
          `Failed to list storage: ${errorMessage(error)}`,
        );
      });

    const folders = (response.CommonPrefixes ?? []).map((cp) =>
      this.toFolderDto(cp, normalized),
    );
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
        { abortSignal: this.abortSignal() },
      )
      .catch((error: unknown) => {
        throw new InternalServerErrorException(
          `Failed to create folder: ${errorMessage(error)}`,
        );
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
    return this.uploadFile(prefix, filename, { buffer }, contentType);
  }

  async uploadFile(
    prefix: string,
    filename: string,
    file: UploadedFileLike,
    contentType?: string,
  ): Promise<StorageObjectDto> {
    if (!hasUploadedContent(file)) {
      throw new BadRequestException('File is required');
    }

    const client = this.requireClient();
    assertSafeKeySegment(filename, 'filename');
    const key = joinKey(prefix, filename);
    assertSafeKey(key, 'key');

    const body: Buffer | Readable = file.path
      ? openUploadedFileStream(file)
      : (file.buffer as Buffer);
    const size =
      typeof file.size === 'number' && file.size >= 0
        ? file.size
        : Buffer.isBuffer(body)
          ? body.length
          : undefined;

    const response = await client
      .send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType || 'application/octet-stream',
          ...(typeof size === 'number' ? { ContentLength: size } : {}),
        }),
        { abortSignal: this.abortSignal() },
      )
      .catch((error: unknown) => {
        throw new InternalServerErrorException(
          `Failed to upload file: ${errorMessage(error)}`,
        );
      });

    return {
      key,
      name: basename(key),
      type: 'file',
      size: size ?? 0,
      contentType: contentType || 'application/octet-stream',
      lastModified: new Date().toISOString(),
      etag: response.ETag?.replace(/"/g, ''),
    };
  }

  async rename(
    fromKey: string,
    toKey: string,
  ): Promise<StorageObjectDto | StorageFolderMutationResultDto> {
    const client = this.requireClient();
    assertSafeKey(fromKey, 'fromKey');
    assertSafeKey(toKey, 'toKey');

    const folderRename = isFolderKey(fromKey) || isFolderKey(toKey);
    const normalizedFrom =
      folderRename && !isFolderKey(fromKey) ? `${fromKey}/` : fromKey;
    const normalizedTo =
      folderRename && !isFolderKey(toKey) ? `${toKey}/` : toKey;

    if (isFolderKey(normalizedFrom) !== isFolderKey(normalizedTo)) {
      throw new BadRequestException(
        'Cannot rename between file and folder types',
      );
    }

    if (isFolderKey(normalizedFrom)) {
      const objectCount = await this.renameFolderPrefix(
        normalizedFrom,
        normalizedTo,
      );
      return {
        key: normalizedTo,
        name: basename(normalizedTo.replace(/\/$/, '')),
        type: 'folder',
        objectCount,
        warning: this.folderSizeWarning(objectCount),
      };
    }

    // Single-file rename stays fully synchronous (PERF-04).
    await client
      .send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${normalizedFrom}`,
          Key: normalizedTo,
        }),
        { abortSignal: this.abortSignal() },
      )
      .catch((error: unknown) => {
        throw new InternalServerErrorException(
          `Failed to rename file: ${errorMessage(error)}`,
        );
      });

    await client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: normalizedFrom }),
      { abortSignal: this.abortSignal() },
    );

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

    // Single-file delete stays fully synchronous (PERF-04).
    await client
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), {
        abortSignal: this.abortSignal(),
      })
      .catch((error: unknown) => {
        throw new InternalServerErrorException(
          `Failed to delete object: ${errorMessage(error)}`,
        );
      });
  }

  async getDownloadUrl(
    key: string,
    expiresInSeconds = 3600,
  ): Promise<{ url: string; expiresAt: string }> {
    const client = this.requireClient();
    assertSafeKey(key, 'key');
    if (isFolderKey(key)) {
      throw new BadRequestException('Cannot download a folder');
    }

    const expiresAt = new Date(
      Date.now() + expiresInSeconds * 1000,
    ).toISOString();
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    ).catch((error: unknown) => {
      throw new InternalServerErrorException(
        `Failed to create download URL: ${errorMessage(error)}`,
      );
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
    const name = prefix
      ? key.slice(prefix.length).replace(/\/$/, '')
      : key.replace(/\/$/, '');
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

  private folderSizeWarning(objectCount: number): string | undefined {
    const warnAt = Math.floor(this.folderSyncMaxObjects * FOLDER_WARN_RATIO);
    if (objectCount < warnAt) {
      return undefined;
    }
    return `Folder operation touched ${objectCount} objects (sync limit ${this.folderSyncMaxObjects}). Prefer smaller folders for rename/delete.`;
  }

  private async assertFolderWithinSyncLimit(prefix: string): Promise<number> {
    const count = await this.countObjectsUnderPrefix(prefix);
    if (count > this.folderSyncMaxObjects) {
      throw new BadRequestException(
        `Folder has ${count} objects; sync rename/delete is limited to ${this.folderSyncMaxObjects}. ` +
          'Split the folder or delete/rename in smaller batches. Single-file operations remain unlimited.',
      );
    }
    return count;
  }

  private async countObjectsUnderPrefix(prefix: string): Promise<number> {
    const client = this.requireClient();
    let continuationToken: string | undefined;
    let total = 0;

    do {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
        { abortSignal: this.abortSignal() },
      );

      total += listed.KeyCount ?? listed.Contents?.length ?? 0;
      if (total > this.folderSyncMaxObjects) {
        return total;
      }

      continuationToken = listed.IsTruncated
        ? listed.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return total;
  }

  private async deleteFolderRecursive(prefix: string): Promise<void> {
    const client = this.requireClient();
    await this.assertFolderWithinSyncLimit(prefix);

    let continuationToken: string | undefined;

    do {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
        { abortSignal: this.abortSignal() },
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
          { abortSignal: this.abortSignal() },
        );
      }

      continuationToken = listed.IsTruncated
        ? listed.NextContinuationToken
        : undefined;
    } while (continuationToken);
  }

  private async renameFolderPrefix(
    fromPrefix: string,
    toPrefix: string,
  ): Promise<number> {
    const client = this.requireClient();
    const objectCount = await this.assertFolderWithinSyncLimit(fromPrefix);
    let continuationToken: string | undefined;

    do {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: fromPrefix,
          ContinuationToken: continuationToken,
        }),
        { abortSignal: this.abortSignal() },
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
          { abortSignal: this.abortSignal() },
        );
        await client.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: obj.Key }),
          { abortSignal: this.abortSignal() },
        );
      }

      continuationToken = listed.IsTruncated
        ? listed.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return objectCount;
  }
}
