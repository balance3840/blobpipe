import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
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
import type { AzureBlobAuth, AzureBlobDriverConfig } from './types.js';
import {
  BlobSASPermissions,
  BlobServiceClient,
  StorageSharedKeyCredential,
  type BlockBlobUploadOptions,
  type BlockBlobUploadStreamOptions,
} from '@azure/storage-blob';
import type { TokenCredential } from '@azure/core-auth';

type BlobPutOptions = Pick<
  BlockBlobUploadOptions & BlockBlobUploadStreamOptions,
  'blobHTTPHeaders' | 'metadata' | 'abortSignal'
>;

function toBuffer(data: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.from(data);
}

function isNotFoundError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; statusCode?: number };
  // HEAD requests return no XML body, so code is undefined — fall back to statusCode.
  if (e.statusCode === 404) return true;
  return e.code === 'BlobNotFound' || e.code === 'ContainerNotFound';
}

function isAccessDeniedError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  return code === 'AuthorizationFailure' || code === 'AuthorizationPermissionMismatch';
}

function isAlreadyExistsError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  return code === 'BlobAlreadyExists';
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
 * StorageDriver implementation backed by Azure Blob Storage.
 *
 * Uses `@azure/storage-blob` (BlockBlobClient for put/get/delete,
 * ContainerClient for list) and generates SAS tokens for `getSignedUrl`.
 *
 * Note: Azure's SAS token semantics differ from S3 presigned URLs (e.g.
 * permission scopes are encoded differently); `getSignedUrl` normalizes
 * the common case (time-limited read/write/delete) but does not expose every
 * Azure-specific SAS option through this interface.
 */
export class AzureBlobDriver implements StorageDriver {
  readonly name = 'azure-blob';
  protected client: BlobServiceClient;

  constructor(protected readonly config: AzureBlobDriverConfig) {
    this.client = this.createBlobServiceClient(config.auth);
  }

  createBlobServiceClient(auth: AzureBlobAuth): BlobServiceClient {
    switch (auth.mode) {
      case 'connection-string':
        return BlobServiceClient.fromConnectionString(auth.connectionString);
      case 'shared-key': {
        const credential = new StorageSharedKeyCredential(auth.accountName, auth.accountKey);
        const endpoint = auth.endpoint ?? this.getDefaultEndpoint(auth.accountName);
        return new BlobServiceClient(endpoint, credential);
      }
      case 'token-credential': {
        const endpoint = auth.endpoint ?? this.getDefaultEndpoint(auth.accountName);
        return new BlobServiceClient(endpoint, auth.credential as TokenCredential);
      }
      default:
        const _exhaustive: never = auth;
        return _exhaustive;
    }
  }

  getDefaultEndpoint(accountName: string): string {
    return `https://${accountName}.blob.core.windows.net`;
  }

  private containerClient() {
    return this.client.getContainerClient(this.config.containerName);
  }

  private fullKey(key: string): string {
    return this.config.keyPrefix ? `${this.config.keyPrefix}${key}` : key;
  }

  async put(key: string, data: UploadBody, opts?: PutOptions): Promise<PutResult> {
    const containerClient = this.containerClient();
    await containerClient.createIfNotExists(
      opts?.access === 'public-read' ? { access: 'blob' } : {},
    );

    const blockBlobClient = containerClient.getBlockBlobClient(this.fullKey(key));
    const blobOpts = this.buildBlobPutOptions(opts);

    if (data instanceof Readable) {
      // Note: storageClass (access tier) is not applied to stream uploads for simplicity.
      // Use the buffer path if you need to set an access tier atomically.
      const response = await blockBlobClient.uploadStream(
        data,
        this.config.uploadBufferSize,
        this.config.uploadConcurrency,
        {
          ...blobOpts,
          ...(opts?.onProgress && { onProgress: (p: { loadedBytes: number }) => opts.onProgress!(p.loadedBytes) }),
        },
      );
      return { key, ...(response.etag && { etag: response.etag }), uploadedAt: new Date() };
    }

    const buffer = toBuffer(data);
    const checksum = createHash('sha256').update(buffer).digest('base64');

    try {
      const response = await blockBlobClient.upload(buffer, buffer.byteLength, {
        ...blobOpts,
        ...(opts?.ifNoneMatch === '*' && { conditions: { ifNoneMatch: '*' } }),
      });

      if (opts?.storageClass) {
        await blockBlobClient.setAccessTier(opts.storageClass);
      }

      opts?.onProgress?.(buffer.byteLength, buffer.byteLength);

      return {
        key,
        size: buffer.byteLength,
        ...(response.etag && { etag: response.etag }),
        checksum,
        uploadedAt: new Date(),
      };
    } catch (err) {
      if (opts?.ifNoneMatch === '*' && isAlreadyExistsError(err)) {
        throw new ObjectAlreadyExistsError(key, this.name, { cause: err });
      }
      throw err;
    }
  }

  async get(key: string, opts?: GetOptions): Promise<Readable> {
    const blockBlobClient = this.containerClient().getBlockBlobClient(this.fullKey(key));
    try {
      const offset = opts?.start ?? 0;
      const count = opts?.end !== undefined ? opts.end - offset + 1 : undefined;
      const response = await blockBlobClient.download(offset, count, {
        ...(opts?.signal && { abortSignal: opts.signal }),
      });
      if (!response.readableStreamBody) {
        throw new StorageOperationError(`Empty response body for "${key}"`, this.name);
      }
      return response.readableStreamBody as Readable;
    } catch (err) {
      if (isNotFoundError(err)) throw new ObjectNotFoundError(key, this.name, { cause: err });
      if (isAccessDeniedError(err)) throw new AccessDeniedError(key, this.name, { cause: err });
      throw err;
    }
  }

  async delete(key: string, opts?: DeleteOptions): Promise<void> {
    await this.containerClient().getBlockBlobClient(this.fullKey(key)).deleteIfExists({
      ...(opts?.signal && { abortSignal: opts.signal }),
    });
  }

  async deleteMany(keys: string[], opts?: DeleteManyOptions): Promise<DeleteManyResult> {
    // Azure has no native batch blob delete — fan out with concurrency limit of 10.
    const deleted: string[] = [];
    const failed: Array<{ key: string; error: unknown }> = [];

    const tasks = keys.map((key) => async () => {
      opts?.signal?.throwIfAborted();
      await this.containerClient().getBlockBlobClient(this.fullKey(key)).deleteIfExists({
        ...(opts?.signal && { abortSignal: opts.signal }),
      });
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
    return this.containerClient().getBlockBlobClient(this.fullKey(key)).exists({
      ...(opts?.signal && { abortSignal: opts.signal }),
    });
  }

  async stat(key: string, opts?: StatOptions): Promise<StorageObject> {
    const blockBlobClient = this.containerClient().getBlockBlobClient(this.fullKey(key));
    try {
      const props = await blockBlobClient.getProperties({
        ...(opts?.signal && { abortSignal: opts.signal }),
      });
      return {
        key,
        size: props.contentLength ?? 0,
        lastModified: props.lastModified ?? new Date(),
        ...(props.etag && { etag: props.etag }),
        ...(props.metadata && { metadata: props.metadata }),
      };
    } catch (err) {
      if (isNotFoundError(err)) throw new ObjectNotFoundError(key, this.name, { cause: err });
      if (isAccessDeniedError(err)) throw new AccessDeniedError(key, this.name, { cause: err });
      throw err;
    }
  }

  getUrl(key: string): string {
    const auth = this.config.auth;
    const endpoint =
      auth.mode !== 'connection-string' && auth.endpoint
        ? auth.endpoint.replace(/\/$/, '')
        : auth.mode !== 'connection-string'
          ? this.getDefaultEndpoint(auth.accountName)
          : this.client.url.replace(/\/$/, '');
    return `${endpoint}/${this.config.containerName}/${this.fullKey(key)}`;
  }

  async getSignedUrl(key: string, opts?: SignedUrlOptions): Promise<string> {
    const expiresInSeconds = opts?.expiresInSeconds ?? 3600;
    const permissions =
      opts?.operation === 'delete'
        ? BlobSASPermissions.parse('d')
        : opts?.operation === 'write'
          ? BlobSASPermissions.parse('cw')
          : BlobSASPermissions.parse('r');
    // Start slightly in the past to tolerate clock skew between client and Azure.
    const startsOn = new Date(Date.now() - 60_000);
    const expiresOn = new Date(Date.now() + expiresInSeconds * 1000);

    const blockBlobClient = this.containerClient().getBlockBlobClient(this.fullKey(key));
    const sasOptions = { permissions, startsOn, expiresOn };

    if (this.config.auth.mode === 'token-credential') {
      try {
        const userDelegationKey = await this.client.getUserDelegationKey(startsOn, expiresOn);
        return blockBlobClient.generateUserDelegationSasUrl(sasOptions, userDelegationKey);
      } catch (err) {
        if (isAccessDeniedError(err)) {
          throw new AccessDeniedError(
            key,
            this.name,
            { cause: new Error(
              'Generating a user delegation SAS requires the "Storage Blob Delegator" role ' +
              'on the storage account in addition to "Storage Blob Data Contributor". ' +
              'Assign it with: az role assignment create --role "Storage Blob Delegator" ' +
              `--assignee <your-object-id> --scope /subscriptions/.../storageAccounts/${this.config.auth.accountName}`,
              { cause: err },
            )},
          );
        }
        throw err;
      }
    }

    // shared-key and connection-string both use StorageSharedKeyCredential internally
    return blockBlobClient.generateSasUrl(sasOptions);
  }

  async copy(sourceKey: string, destKey: string, opts?: CopyOptions): Promise<void> {
    const sourceClient = this.containerClient().getBlockBlobClient(this.fullKey(sourceKey));
    const destClient = this.containerClient().getBlockBlobClient(this.fullKey(destKey));
    try {
      const poller = await destClient.beginCopyFromURL(sourceClient.url, {
        ...(opts?.metadata && { metadata: opts.metadata }),
      });
      await poller.pollUntilDone();
      if (opts?.access === 'public-read') {
        await this.containerClient().setAccessPolicy('blob');
      }
    } catch (err) {
      if (isNotFoundError(err)) throw new ObjectNotFoundError(sourceKey, this.name, { cause: err });
      if (isAccessDeniedError(err)) throw new AccessDeniedError(sourceKey, this.name, { cause: err });
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
    opts?.signal?.throwIfAborted();

    const prefix = opts?.prefix
      ? this.config.keyPrefix
        ? `${this.config.keyPrefix}${opts.prefix}`
        : opts.prefix
      : this.config.keyPrefix;

    const pageSize = opts?.limit ?? 5000;
    const iter = this.containerClient()
      .listBlobsFlat(prefix ? { prefix } : {})
      .byPage({ maxPageSize: pageSize, ...(opts?.cursor && { continuationToken: opts.cursor }) });

    const page = await iter.next();
    if (page.done || !page.value) return { items: [] };

    const items: StorageObject[] = (page.value.segment.blobItems ?? []).map((blob) => {
      const rawKey = blob.name;
      const key =
        this.config.keyPrefix && rawKey.startsWith(this.config.keyPrefix)
          ? rawKey.slice(this.config.keyPrefix.length)
          : rawKey;
      return {
        key,
        size: blob.properties.contentLength ?? 0,
        lastModified: blob.properties.lastModified,
        etag: blob.properties.etag,
        ...(blob.metadata && { metadata: blob.metadata }),
      };
    });

    return {
      items,
      ...(page.value.continuationToken && { nextCursor: page.value.continuationToken }),
    };
  }

  async *list(opts?: ListOptions): AsyncIterable<StorageObject> {
    opts?.signal?.throwIfAborted();

    const prefix = opts?.prefix
      ? this.config.keyPrefix
        ? `${this.config.keyPrefix}${opts.prefix}`
        : opts.prefix
      : this.config.keyPrefix;

    const iter = this.containerClient().listBlobsFlat(prefix ? { prefix } : {});
    let count = 0;
    const limit = opts?.limit;

    for await (const blob of iter) {
      opts?.signal?.throwIfAborted();
      if (limit !== undefined && count >= limit) break;
      const rawKey = blob.name;
      const key =
        this.config.keyPrefix && rawKey.startsWith(this.config.keyPrefix)
          ? rawKey.slice(this.config.keyPrefix.length)
          : rawKey;
      yield {
        key,
        size: blob.properties.contentLength ?? 0,
        lastModified: blob.properties.lastModified,
        etag: blob.properties.etag,
        ...(blob.metadata && { metadata: blob.metadata }),
      };
      count++;
    }
  }

  private buildBlobPutOptions(opts?: PutOptions): BlobPutOptions {
    return {
      ...(opts?.contentType && { blobHTTPHeaders: { blobContentType: opts.contentType } }),
      ...(opts?.metadata && { metadata: opts.metadata }),
      ...(opts?.signal && { abortSignal: opts.signal }),
    };
  }
}
