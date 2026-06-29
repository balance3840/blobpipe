import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Storage, File as GCSFile } from '@google-cloud/storage';
import type { StorageDriver } from '@restrella/blobpipe';
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
} from '@restrella/blobpipe';
import { AccessDeniedError, ObjectAlreadyExistsError, ObjectNotFoundError, StorageOperationError } from '@restrella/blobpipe';
import type { GcsDriverConfig } from './types.js';

function isNotFoundError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as { code?: unknown }).code === 404;
}

function isAccessDeniedError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as { code?: unknown }).code === 403;
}

function isPreconditionFailedError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as { code?: unknown }).code === 412;
}

function toBuffer(data: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  return Buffer.from(data, 'utf8');
}

function parseSize(value: number | string | undefined): number {
  if (typeof value === 'number') return value;
  return value !== undefined ? parseInt(value, 10) : 0;
}

/** Simple concurrency-limited `Promise.allSettled`. No external deps. */
async function pLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  let i = 0;
  async function run(): Promise<void> {
    while (i < tasks.length) {
      const idx = i++;
      try {
        results[idx] = { status: 'fulfilled', value: await tasks[idx]!() };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, run));
  return results;
}

/**
 * StorageDriver implementation backed by Google Cloud Storage.
 *
 * Uses `@google-cloud/storage` for all operations. Signed URLs require a
 * service account with a private key (`key-file` or `credentials` auth mode);
 * ADC via a personal user account cannot generate them.
 *
 * Bucket ACLs (`access: 'public-read'`) require fine-grained access control
 * to be enabled on the bucket. Buckets with uniform bucket-level access (the
 * GCP default) will reject per-object ACL changes.
 */
export class GcsDriver implements StorageDriver {
  readonly name = 'gcs';
  private readonly storage: Storage;

  constructor(private readonly config: GcsDriverConfig) {
    this.storage = this.createStorage();
  }

  private createStorage(): Storage {
    const base = {
      ...(this.config.apiEndpoint && { apiEndpoint: this.config.apiEndpoint }),
    };
    const { auth } = this.config;
    switch (auth.mode) {
      case 'adc':
        return new Storage({ ...base, projectId: auth.projectId });
      case 'key-file':
        return new Storage({ ...base, projectId: auth.projectId, keyFilename: auth.keyFilename });
      case 'credentials':
        return new Storage({
          ...base,
          projectId: auth.projectId,
          credentials: { client_email: auth.clientEmail, private_key: auth.privateKey },
        });
    }
  }

  private fullKey(key: string): string {
    return this.config.keyPrefix ? `${this.config.keyPrefix}${key}` : key;
  }

  private stripPrefix(rawKey: string): string {
    return this.config.keyPrefix && rawKey.startsWith(this.config.keyPrefix)
      ? rawKey.slice(this.config.keyPrefix.length)
      : rawKey;
  }

  private file(key: string): GCSFile {
    return this.storage.bucket(this.config.bucket).file(this.fullKey(key), {
      ...(this.config.kmsKeyName && { kmsKeyName: this.config.kmsKeyName }),
    });
  }

  async put(key: string, data: UploadBody, opts?: PutOptions): Promise<PutResult> {
    const file = this.file(key);
    const saveOpts = {
      ...(opts?.contentType && { contentType: opts.contentType }),
      ...(opts?.metadata && { metadata: { metadata: opts.metadata } }),
      ...(opts?.access === 'public-read' && { public: true }),
    };

    try {
      if (data instanceof Readable) {
        // createWriteStream uses GCS resumable upload protocol — handles files of
        // any size without buffering into memory, and can survive transient failures.
        const writeStream = file.createWriteStream({
          ...saveOpts,
          resumable: true,
          ...(opts?.ifNoneMatch === '*' && { preconditionOpts: { ifGenerationMatch: 0 } }),
        });

        try {
          const onProgress = opts?.onProgress;
          if (onProgress !== undefined) {
            let transferred = 0;
            const counter = new Transform({
              transform(chunk: Buffer, _enc, cb) {
                transferred += chunk.length;
                onProgress(transferred, undefined);
                cb(null, chunk);
              },
            });
            await pipeline(data, counter, writeStream);
          } else {
            await pipeline(data, writeStream);
          }
        } catch (err) {
          if (opts?.ifNoneMatch === '*' && isPreconditionFailedError(err)) {
            throw new ObjectAlreadyExistsError(key, this.name, { cause: err });
          }
          throw err;
        }

        if (opts?.storageClass) {
          await file.setStorageClass(opts.storageClass);
        }

        return { key, uploadedAt: new Date() };
      }

      const buffer = toBuffer(data);
      const checksum = createHash('sha256').update(buffer).digest('base64');

      try {
        // resumable: false → single-request multipart upload, faster for small buffers.
        await file.save(buffer, {
          ...saveOpts,
          resumable: false,
          ...(opts?.ifNoneMatch === '*' && { preconditionOpts: { ifGenerationMatch: 0 } }),
        });
      } catch (err) {
        if (opts?.ifNoneMatch === '*' && isPreconditionFailedError(err)) {
          throw new ObjectAlreadyExistsError(key, this.name, { cause: err });
        }
        throw err;
      }

      if (opts?.storageClass) {
        await file.setStorageClass(opts.storageClass);
      }

      opts?.onProgress?.(buffer.byteLength, buffer.byteLength);

      return {
        key,
        size: buffer.byteLength,
        ...(file.metadata.etag && { etag: file.metadata.etag as string }),
        checksum,
        uploadedAt: new Date(),
      };
    } catch (err) {
      if (err instanceof ObjectAlreadyExistsError) throw err;
      if (isAccessDeniedError(err)) throw new AccessDeniedError(key, this.name, { cause: err });
      throw new StorageOperationError(
        `Failed to upload "${key}": ${err instanceof Error ? err.message : String(err)}`,
        this.name,
        { cause: err },
      );
    }
  }

  async get(key: string, opts?: GetOptions): Promise<Readable> {
    opts?.signal?.throwIfAborted();
    // GCS createReadStream() is lazy — errors surface during consumption, not at call time.
    // We check existence upfront to eagerly throw ObjectNotFoundError, matching the contract
    // of all other drivers where get() rejects the promise for missing keys.
    const file = this.file(key);
    try {
      const [exists] = await file.exists();
      if (!exists) throw new ObjectNotFoundError(key, this.name);
      return file.createReadStream({
        ...(opts?.start !== undefined && { start: opts.start }),
        ...(opts?.end !== undefined && { end: opts.end }),
      });
    } catch (err) {
      if (err instanceof ObjectNotFoundError) throw err;
      if (isNotFoundError(err)) throw new ObjectNotFoundError(key, this.name, { cause: err });
      if (isAccessDeniedError(err)) throw new AccessDeniedError(key, this.name, { cause: err });
      throw err;
    }
  }

  async delete(key: string, opts?: DeleteOptions): Promise<void> {
    opts?.signal?.throwIfAborted();
    // ignoreNotFound: true makes delete idempotent — no throw for missing keys.
    await this.file(key).delete({ ignoreNotFound: true });
  }

  async deleteMany(keys: string[], opts?: DeleteManyOptions): Promise<DeleteManyResult> {
    // GCS has no native batch delete API — fan out with concurrency limit of 10.
    const deleted: string[] = [];
    const failed: Array<{ key: string; error: unknown }> = [];

    const tasks = keys.map((key) => async () => {
      opts?.signal?.throwIfAborted();
      // ignoreNotFound: true keeps delete idempotent.
      await this.file(key).delete({ ignoreNotFound: true });
      return key;
    });

    const results = await pLimit(tasks, 10);

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const key = keys[i]!;
      if (result.status === 'fulfilled') {
        deleted.push(result.value);
      } else {
        failed.push({ key, error: result.reason });
      }
    }

    return { deleted, failed };
  }

  async exists(key: string, opts?: ExistsOptions): Promise<boolean> {
    opts?.signal?.throwIfAborted();
    const [exists] = await this.file(key).exists();
    return exists;
  }

  async stat(key: string, opts?: StatOptions): Promise<StorageObject> {
    opts?.signal?.throwIfAborted();
    const file = this.file(key);
    try {
      const [metadata] = await file.getMetadata();
      const customMeta = metadata.metadata as Record<string, string> | undefined;
      return {
        key,
        size: parseSize(metadata.size),
        lastModified: new Date(metadata.updated ?? metadata.timeCreated ?? Date.now()),
        ...(metadata.etag && { etag: metadata.etag as string }),
        ...(customMeta && Object.keys(customMeta).length > 0 && { metadata: customMeta }),
      };
    } catch (err) {
      if (isNotFoundError(err)) throw new ObjectNotFoundError(key, this.name, { cause: err });
      if (isAccessDeniedError(err)) throw new AccessDeniedError(key, this.name, { cause: err });
      throw err;
    }
  }

  getUrl(key: string): string {
    const fullKey = this.fullKey(key);
    if (this.config.apiEndpoint) {
      const base = this.config.apiEndpoint.replace(/\/$/, '');
      return `${base}/${this.config.bucket}/${fullKey}`;
    }
    return `https://storage.googleapis.com/${this.config.bucket}/${fullKey}`;
  }

  async getSignedUrl(key: string, opts?: SignedUrlOptions): Promise<string> {
    const expiresInSeconds = opts?.expiresInSeconds ?? 3600;
    const action =
      opts?.operation === 'delete'
        ? ('delete' as const)
        : opts?.operation === 'write'
          ? ('write' as const)
          : ('read' as const);
    try {
      const [url] = await this.file(key).getSignedUrl({
        version: 'v4',
        action,
        expires: Date.now() + expiresInSeconds * 1000,
        // Binding contentType makes GCS enforce a matching Content-Type header on upload,
        // preventing type-spoofing via the URL. Only meaningful for write operations.
        ...(action === 'write' && opts?.contentType && { contentType: opts.contentType }),
      });
      return url;
    } catch (err) {
      if (isAccessDeniedError(err)) throw new AccessDeniedError(key, this.name, { cause: err });
      throw err;
    }
  }

  async copy(sourceKey: string, destKey: string, opts?: CopyOptions): Promise<void> {
    opts?.signal?.throwIfAborted();
    const dest = this.storage.bucket(this.config.bucket).file(this.fullKey(destKey));
    try {
      await this.file(sourceKey).copy(dest, {
        ...(opts?.metadata && { metadata: opts.metadata }),
        ...(opts?.access === 'public-read' && { public: true }),
      });
    } catch (err) {
      if (isNotFoundError(err)) throw new ObjectNotFoundError(sourceKey, this.name, { cause: err });
      if (isAccessDeniedError(err)) throw new AccessDeniedError(sourceKey, this.name, { cause: err });
      throw err;
    }
  }

  async move(sourceKey: string, destKey: string, opts?: MoveOptions): Promise<void> {
    opts?.signal?.throwIfAborted();
    const dest = this.storage.bucket(this.config.bucket).file(this.fullKey(destKey));
    try {
      await this.file(sourceKey).move(dest);
    } catch (err) {
      if (isNotFoundError(err)) throw new ObjectNotFoundError(sourceKey, this.name, { cause: err });
      if (isAccessDeniedError(err)) throw new AccessDeniedError(sourceKey, this.name, { cause: err });
      throw err;
    }
  }

  async listPage(opts?: ListOptions): Promise<ListPage> {
    opts?.signal?.throwIfAborted();

    const prefix = opts?.prefix
      ? this.config.keyPrefix
        ? `${this.config.keyPrefix}${opts.prefix}`
        : opts.prefix
      : this.config.keyPrefix;

    const { items, nextPageToken } = await this.gcsListPage(
      prefix,
      opts?.cursor,
      opts?.limit,
      opts?.signal,
    );

    return {
      items,
      ...(nextPageToken && { nextCursor: nextPageToken }),
    };
  }

  async *list(opts?: ListOptions): AsyncIterable<StorageObject> {
    opts?.signal?.throwIfAborted();

    const prefix = opts?.prefix
      ? this.config.keyPrefix
        ? `${this.config.keyPrefix}${opts.prefix}`
        : opts.prefix
      : this.config.keyPrefix;

    let pageToken: string | undefined;
    let count = 0;
    const limit = opts?.limit;

    do {
      opts?.signal?.throwIfAborted();
      const { items, nextPageToken } = await this.gcsListPage(prefix, pageToken, undefined, opts?.signal);
      for (const item of items) {
        if (limit !== undefined && count >= limit) return;
        yield item;
        count++;
      }
      pageToken = nextPageToken;
    } while (pageToken);
  }

  // Uses native fetch (undici) instead of the SDK's getFiles()/getFilesStream() to avoid
  // a race condition in node-fetch@2 (used by @google-cloud/common) with chunked responses
  // on fast Linux hosts.
  private async gcsListPage(
    prefix: string | undefined,
    pageToken: string | undefined,
    maxResults: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<{ items: StorageObject[]; nextPageToken?: string }> {
    const apiBase = (this.config.apiEndpoint ?? 'https://storage.googleapis.com').replace(/\/$/, '');
    const qs = new URLSearchParams();
    if (prefix) qs.set('prefix', prefix);
    if (pageToken) qs.set('pageToken', pageToken);
    if (maxResults !== undefined) qs.set('maxResults', String(maxResults));

    const url = `${apiBase}/storage/v1/b/${encodeURIComponent(this.config.bucket)}/o?${qs}`;

    // For custom endpoints (emulators), the SDK bypasses auth; do the same here.
    // For production GCS, get a Bearer token from the SDK's auth client.
    let headers: Record<string, string> = {};
    if (!this.config.apiEndpoint) {
      const authClient = (this.storage as unknown as { authClient: { getRequestHeaders(url: string): Promise<Record<string, string>> } }).authClient;
      headers = await authClient.getRequestHeaders(url);
    }

    const res = await fetch(url, {
      headers,
      ...(signal != null && { signal }),
    });
    if (!res.ok) {
      throw new StorageOperationError(`GCS list failed with status ${res.status}`, this.name);
    }

    type GCSObjectResource = {
      name: string;
      size?: string | number;
      updated?: string;
      timeCreated?: string;
      etag?: string;
      metadata?: Record<string, string>;
    };
    const data = (await res.json()) as { items?: GCSObjectResource[]; nextPageToken?: string };

    const items: StorageObject[] = (data.items ?? []).map((obj) => {
      const key = this.stripPrefix(obj.name);
      const customMeta = obj.metadata;
      return {
        key,
        size: parseSize(obj.size),
        lastModified: new Date(obj.updated ?? obj.timeCreated ?? Date.now()),
        ...(obj.etag && { etag: obj.etag }),
        ...(customMeta && Object.keys(customMeta).length > 0 && { metadata: customMeta }),
      };
    });

    return {
      items,
      ...(data.nextPageToken && { nextPageToken: data.nextPageToken }),
    };
  }
}
