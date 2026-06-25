import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCopyCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type PutObjectCommandInput,
  type ObjectCannedACL,
  type StorageClass,
  type ServerSideEncryption,
  type CompletedPart,
  type ObjectIdentifier,
  ChecksumAlgorithm,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageDriver } from '@blobpipe/core';
import type {
  CopyOptions,
  DeleteManyOptions,
  DeleteManyResult,
  DeleteOptions,
  ExistsOptions,
  GetOptions,
  ListOptions,
  ListPage,
  MoveOptions,
  PutOptions,
  PutResult,
  SignedUrlOptions,
  StatOptions,
  StorageObject,
  UploadBody,
} from '@blobpipe/core';
import {
  AccessDeniedError,
  ObjectAlreadyExistsError,
  ObjectNotFoundError,
  StorageOperationError,
} from '@blobpipe/core';
import type { S3DriverConfig } from './types.js';

function isNotFoundError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === 'NoSuchKey' ||
    e.name === 'NotFound' ||
    e.Code === 'NoSuchKey' ||
    e.$metadata?.httpStatusCode === 404
  );
}

function isAccessDeniedError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === 'AccessDenied' ||
    e.Code === 'AccessDenied' ||
    e.$metadata?.httpStatusCode === 403
  );
}

function isPreconditionFailedError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === 'PreconditionFailed' ||
    e.name === 'ConditionalRequestConflict' ||
    e.$metadata?.httpStatusCode === 412
  );
}

/**
 * StorageDriver implementation backed by Amazon S3 (or any S3-compatible
 * endpoint — see `endpoint`/`forcePathStyle` in S3DriverConfig).
 *
 * Uses `@aws-sdk/client-s3` (PutObject, GetObject, DeleteObject, HeadObject,
 * ListObjectsV2, DeleteObjects) and `@aws-sdk/s3-request-presigner` for `getSignedUrl`.
 */
export class S3Driver implements StorageDriver {
  readonly name = 's3';
  private readonly client: S3Client;

  constructor(private readonly config: S3DriverConfig) {
    this.client = new S3Client({
      region: config.region,
      ...(config.credentials && { credentials: config.credentials }),
      ...(config.endpoint && { endpoint: config.endpoint }),
      ...(config.forcePathStyle !== undefined && { forcePathStyle: config.forcePathStyle }),
      ...(config.requestChecksumCalculation && { requestChecksumCalculation: config.requestChecksumCalculation }),
      ...(config.responseChecksumValidation && { responseChecksumValidation: config.responseChecksumValidation }),
    });
  }

  private fullKey(key: string): string {
    return this.config.keyPrefix ? `${this.config.keyPrefix}${key}` : key;
  }

  private stripPrefix(rawKey: string): string {
    return this.config.keyPrefix && rawKey.startsWith(this.config.keyPrefix)
      ? rawKey.slice(this.config.keyPrefix.length)
      : rawKey;
  }

  async put(key: string, data: UploadBody, opts?: PutOptions): Promise<PutResult> {
    const commonParams = {
      Bucket: this.config.bucket,
      Key: this.fullKey(key),
      ...(opts?.contentType && { ContentType: opts.contentType }),
      ...(opts?.metadata && { Metadata: opts.metadata }),
      ...(opts?.access === 'public-read' && { ACL: 'public-read' as ObjectCannedACL }),
      ...(opts?.storageClass && { StorageClass: opts.storageClass as StorageClass }),
      ...(this.config.sse && { ServerSideEncryption: this.config.sse as ServerSideEncryption }),
      ...(this.config.sseKmsKeyId && { SSEKMSKeyId: this.config.sseKmsKeyId }),
    };

    // Streams use multipart upload via @aws-sdk/lib-storage — no buffering needed,
    // handles files of any size and avoids the ContentLength requirement of PutObject.
    if (data instanceof Readable) {
      // For stream + ifNoneMatch: check existence first (not atomic — the Upload class
      // does not support IfNoneMatch natively, so this is a best-effort guard).
      if (opts?.ifNoneMatch === '*') {
        const alreadyExists = await this.exists(key);
        if (alreadyExists) throw new ObjectAlreadyExistsError(key, this.name);
      }

      const upload = new Upload({
        client: this.client,
        params: { ...commonParams, Body: data },
        ...(opts?.signal && { abortController: { signal: opts.signal, abort: () => {} } }),
      });

      upload.on('httpUploadProgress', (progress) => {
        opts?.onProgress?.(progress.loaded ?? 0, progress.total);
      });

      const response = await upload.done();
      return {
        key,
        ...(response.ETag && { etag: response.ETag }),
        ...(response.ChecksumSHA256 && { checksum: response.ChecksumSHA256 }),
        uploadedAt: new Date(),
      };
    }

    const size =
      Buffer.isBuffer(data)
        ? data.byteLength
        : data instanceof Uint8Array
          ? data.byteLength
          : Buffer.byteLength(data, 'utf8');

    const checksum = createHash('sha256')
      .update(Buffer.isBuffer(data) ? data : data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(data, 'utf8'))
      .digest('base64');

    const input: PutObjectCommandInput = {
      ...commonParams,
      Body: data as Exclude<PutObjectCommandInput['Body'], undefined>,
      ContentLength: size,
      ChecksumAlgorithm: ChecksumAlgorithm.SHA256,
      ChecksumSHA256: checksum,
      ...(opts?.ifNoneMatch === '*' && { IfNoneMatch: '*' }),
    };

    try {
      const response = await this.client.send(new PutObjectCommand(input), {
        ...(opts?.signal && { abortSignal: opts.signal }),
      });
      opts?.onProgress?.(size, size);
      return {
        key,
        size,
        ...(response.ETag && { etag: response.ETag }),
        checksum,
        uploadedAt: new Date(),
      };
    } catch (err) {
      if (opts?.ifNoneMatch === '*' && isPreconditionFailedError(err)) {
        throw new ObjectAlreadyExistsError(key, this.name, { cause: err });
      }
      throw err;
    }
  }

  async get(key: string, opts?: GetOptions): Promise<Readable> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: this.fullKey(key),
          ...(opts?.start !== undefined && {
            Range: `bytes=${opts.start}-${opts.end !== undefined ? opts.end : ''}`,
          }),
        }),
        { ...(opts?.signal && { abortSignal: opts.signal }) },
      );
      if (!response.Body) {
        throw new StorageOperationError(`Empty response body for "${key}"`, this.name);
      }
      // In Node.js, response.Body is SdkStreamMixin & Readable.
      return response.Body as unknown as Readable;
    } catch (err) {
      if (isNotFoundError(err)) throw new ObjectNotFoundError(key, this.name, { cause: err });
      if (isAccessDeniedError(err)) throw new AccessDeniedError(key, this.name, { cause: err });
      throw err;
    }
  }

  async delete(key: string, opts?: DeleteOptions): Promise<void> {
    // S3 DeleteObject is idempotent — silently succeeds for missing keys.
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: this.fullKey(key) }),
      { ...(opts?.signal && { abortSignal: opts.signal }) },
    );
  }

  async deleteMany(keys: string[], opts?: DeleteManyOptions): Promise<DeleteManyResult> {
    const ignoreNotFound = opts?.ignoreNotFound ?? true;
    const deleted: string[] = [];
    const failed: Array<{ key: string; error: unknown }> = [];

    const AWS_BATCH_SIZE = 1000;

    for (let i = 0; i < keys.length; i += AWS_BATCH_SIZE) {
      const batch = keys.slice(i, i + AWS_BATCH_SIZE);
      const objects: ObjectIdentifier[] = batch.map((k) => ({ Key: this.fullKey(k) }));

      const response = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.config.bucket,
          Delete: { Objects: objects, Quiet: false },
        }),
        { ...(opts?.signal && { abortSignal: opts.signal }) },
      );

      for (const d of response.Deleted ?? []) {
        deleted.push(this.stripPrefix(d.Key ?? ''));
      }

      for (const e of response.Errors ?? []) {
        const userKey = this.stripPrefix(e.Key ?? '');
        if (ignoreNotFound && (e.Code === 'NoSuchKey' || e.Code === 'NotFound')) {
          deleted.push(userKey);
        } else {
          failed.push({
            key: userKey,
            error: new StorageOperationError(`${e.Code ?? 'Error'}: ${e.Message ?? 'Unknown error'}`, this.name),
          });
        }
      }
    }

    return { deleted, failed };
  }

  async exists(key: string, opts?: ExistsOptions): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: this.fullKey(key) }),
        { ...(opts?.signal && { abortSignal: opts.signal }) },
      );
      return true;
    } catch (err) {
      if (isNotFoundError(err)) return false;
      throw err;
    }
  }

  async stat(key: string, opts?: StatOptions): Promise<StorageObject> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: this.fullKey(key) }),
        { ...(opts?.signal && { abortSignal: opts.signal }) },
      );
      return {
        key,
        size: response.ContentLength ?? 0,
        lastModified: response.LastModified ?? new Date(),
        ...(response.ETag && { etag: response.ETag }),
        ...(response.Metadata &&
          Object.keys(response.Metadata).length > 0 && { metadata: response.Metadata }),
      };
    } catch (err) {
      if (isNotFoundError(err)) throw new ObjectNotFoundError(key, this.name, { cause: err });
      if (isAccessDeniedError(err)) throw new AccessDeniedError(key, this.name, { cause: err });
      throw err;
    }
  }

  getUrl(key: string): string {
    const fullKey = this.fullKey(key);
    if (this.config.endpoint) {
      const base = this.config.endpoint.replace(/\/$/, '');
      return this.config.forcePathStyle
        ? `${base}/${this.config.bucket}/${fullKey}`
        : `${base}/${fullKey}`;
    }
    if (this.config.forcePathStyle) {
      return `https://s3.${this.config.region}.amazonaws.com/${this.config.bucket}/${fullKey}`;
    }
    return `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${fullKey}`;
  }

  async getSignedUrl(key: string, opts?: SignedUrlOptions): Promise<string> {
    const expiresIn = opts?.expiresInSeconds ?? 3600;
    const fullKey = this.fullKey(key);
    const command =
      opts?.operation === 'delete'
        ? new DeleteObjectCommand({ Bucket: this.config.bucket, Key: fullKey })
        : opts?.operation === 'write'
          ? new PutObjectCommand({
              Bucket: this.config.bucket,
              Key: fullKey,
              // Binding ContentType makes AWS reject uploads with a mismatched
              // Content-Type header (HTTP 403), preventing type-spoofing via the URL.
              ...(opts.contentType && { ContentType: opts.contentType }),
            })
          : new GetObjectCommand({ Bucket: this.config.bucket, Key: fullKey });

    return awsGetSignedUrl(this.client, command, { expiresIn });
  }

  async copy(sourceKey: string, destKey: string, opts?: CopyOptions): Promise<void> {
    // Head the source to determine size — needed to decide between single-part and multipart copy.
    let head;
    try {
      head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: this.fullKey(sourceKey) }),
        { ...(opts?.signal && { abortSignal: opts.signal }) },
      );
    } catch (err) {
      if (isNotFoundError(err)) throw new ObjectNotFoundError(sourceKey, this.name, { cause: err });
      if (isAccessDeniedError(err)) throw new AccessDeniedError(sourceKey, this.name, { cause: err });
      throw err;
    }

    const size = head.ContentLength ?? 0;
    const FIVE_GB = 5 * 1024 * 1024 * 1024;

    if (size <= FIVE_GB) {
      // Single-part copy.
      await this.client.send(new CopyObjectCommand({
        Bucket: this.config.bucket,
        CopySource: `${this.config.bucket}/${this.fullKey(sourceKey)}`,
        Key: this.fullKey(destKey),
        ...(opts?.access === 'public-read' && { ACL: 'public-read' }),
        ...(opts?.metadata && { Metadata: opts.metadata, MetadataDirective: 'REPLACE' }),
      }), { ...(opts?.signal && { abortSignal: opts.signal }) });
      return;
    }

    // Multipart copy for objects > 5 GB.
    const PART_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB per part (AWS maximum)
    const sourcePath = `${this.config.bucket}/${this.fullKey(sourceKey)}`;
    const destFullKey = this.fullKey(destKey);

    const uploadResult = await this.client.send(new CreateMultipartUploadCommand({
      Bucket: this.config.bucket,
      Key: destFullKey,
      ...(opts?.access === 'public-read' && { ACL: 'public-read' as ObjectCannedACL }),
      ...(opts?.metadata && { Metadata: opts.metadata }),
    }));

    const uploadId = uploadResult.UploadId;
    if (!uploadId) {
      throw new StorageOperationError(`CreateMultipartUpload did not return an UploadId for "${destKey}"`, this.name);
    }

    const parts: CompletedPart[] = [];
    let byteOffset = 0;
    let partNumber = 1;

    try {
      while (byteOffset < size) {
        const end = Math.min(byteOffset + PART_SIZE - 1, size - 1);
        const { CopyPartResult } = await this.client.send(new UploadPartCopyCommand({
          Bucket: this.config.bucket,
          Key: destFullKey,
          CopySource: sourcePath,
          CopySourceRange: `bytes=${byteOffset}-${end}`,
          PartNumber: partNumber,
          UploadId: uploadId,
        }));
        parts.push({ PartNumber: partNumber, ETag: CopyPartResult?.ETag });
        byteOffset += PART_SIZE;
        partNumber++;
      }

      await this.client.send(new CompleteMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: destFullKey,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }));
    } catch (err) {
      // Best-effort abort to avoid lingering incomplete multipart upload charges.
      await this.client.send(new AbortMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: destFullKey,
        UploadId: uploadId,
      })).catch(() => {});
      throw err;
    }
  }

  async move(sourceKey: string, destKey: string, opts?: MoveOptions): Promise<void> {
    await this.copy(sourceKey, destKey, opts);
    try {
      await this.delete(sourceKey, { ...(opts?.signal && { signal: opts.signal }) });
    } catch (err) {
      // Copy succeeded but delete failed — both source and destination now exist.
      // Caller must retry the delete or clean up manually to avoid duplicate data.
      throw new StorageOperationError(
        `move("${sourceKey}" → "${destKey}"): copy succeeded but source deletion failed. ` +
          `Both keys now exist. Retry the delete to complete the move.`,
        this.name,
        { cause: err },
      );
    }
  }

  async listPage(opts?: ListOptions): Promise<ListPage> {
    const prefix = opts?.prefix
      ? this.config.keyPrefix
        ? `${this.config.keyPrefix}${opts.prefix}`
        : opts.prefix
      : this.config.keyPrefix;

    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.config.bucket,
        ...(prefix && { Prefix: prefix }),
        ...(opts?.cursor && { ContinuationToken: opts.cursor }),
        ...(opts?.limit !== undefined && { MaxKeys: opts.limit }),
      }),
      { ...(opts?.signal && { abortSignal: opts.signal }) },
    );

    const items: StorageObject[] = (response.Contents ?? []).map((obj) => {
      const rawKey = obj.Key ?? '';
      const key = this.stripPrefix(rawKey);
      return {
        key,
        size: obj.Size ?? 0,
        lastModified: obj.LastModified ?? new Date(),
        ...(obj.ETag && { etag: obj.ETag }),
      };
    });

    return {
      items,
      ...(response.NextContinuationToken && { nextCursor: response.NextContinuationToken }),
    };
  }

  async *list(opts?: ListOptions): AsyncIterable<StorageObject> {
    let continuationToken: string | undefined;
    let count = 0;
    const limit = opts?.limit;
    const prefix = opts?.prefix
      ? this.config.keyPrefix
        ? `${this.config.keyPrefix}${opts.prefix}`
        : opts.prefix
      : this.config.keyPrefix;

    do {
      opts?.signal?.throwIfAborted();
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          ...(prefix && { Prefix: prefix }),
          ...(continuationToken && { ContinuationToken: continuationToken }),
          ...(limit !== undefined && { MaxKeys: limit - count }),
        }),
        { ...(opts?.signal && { abortSignal: opts.signal }) },
      );

      for (const obj of response.Contents ?? []) {
        if (limit !== undefined && count >= limit) return;
        const rawKey = obj.Key ?? '';
        const key = this.stripPrefix(rawKey);
        yield {
          key,
          size: obj.Size ?? 0,
          lastModified: obj.LastModified ?? new Date(),
          ...(obj.ETag && { etag: obj.ETag }),
        };
        count++;
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken && (limit === undefined || count < limit));
  }
}
