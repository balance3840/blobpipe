import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
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
  ObjectMetadata,
  PutOptions,
  PutResult,
  SignedUrlOptions,
  StatOptions,
  StorageObject,
  UploadBody,
} from '@restrella/blobpipe';
import { ObjectAlreadyExistsError, ObjectNotFoundError, StorageOperationError } from '@restrella/blobpipe';
import type { MemoryDriverConfig } from './types.js';

interface MemoryEntry {
  data: Buffer;
  contentType?: string;
  metadata?: ObjectMetadata;
  uploadedAt: Date;
}

async function toBuffer(data: UploadBody): Promise<Buffer> {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  const chunks: Buffer[] = [];
  for await (const chunk of data) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * StorageDriver implementation backed by an in-memory Map.
 *
 * Designed for unit tests: no network calls, no filesystem access, no
 * external SDK dependency. Data does not persist across process restarts
 * and is not shared across instances — each `new MemoryDriver()` starts
 * empty.
 *
 * Test helpers `_dump()` and `_clear()` are intentionally kept off the
 * `StorageDriver` interface so they don't appear in production-facing types.
 */
export class MemoryDriver implements StorageDriver {
  readonly name = 'memory';
  private readonly store = new Map<string, MemoryEntry>();

  constructor(private readonly config: MemoryDriverConfig = {}) {}

  private async delay(): Promise<void> {
    const ms = this.config.simulatedLatencyMs;
    if (ms) await new Promise<void>((res) => setTimeout(res, ms));
  }

  async put(key: string, data: UploadBody, opts?: PutOptions): Promise<PutResult> {
    opts?.signal?.throwIfAborted();
    await this.delay();

    // Atomic check for ifNoneMatch — memory store is synchronous so this is truly atomic.
    if (opts?.ifNoneMatch === '*' && this.store.has(key)) {
      throw new ObjectAlreadyExistsError(key, this.name);
    }

    const buffer = await toBuffer(data);
    const uploadedAt = new Date();
    const checksum = createHash('sha256').update(buffer).digest('base64');
    this.store.set(key, {
      data: buffer,
      ...(opts?.contentType && { contentType: opts.contentType }),
      ...(opts?.metadata && { metadata: opts.metadata }),
      uploadedAt,
    });

    opts?.onProgress?.(buffer.byteLength, buffer.byteLength);

    return { key, size: buffer.byteLength, uploadedAt, checksum };
  }

  async get(key: string, opts?: GetOptions): Promise<Readable> {
    opts?.signal?.throwIfAborted();
    await this.delay();
    const entry = this.store.get(key);
    if (!entry) throw new ObjectNotFoundError(key, this.name);
    const start = opts?.start ?? 0;
    const end = opts?.end !== undefined ? opts.end + 1 : undefined;
    const slice = entry.data.slice(start, end);
    return Readable.from(slice);
  }

  async delete(key: string, opts?: DeleteOptions): Promise<void> {
    opts?.signal?.throwIfAborted();
    await this.delay();
    this.store.delete(key);
  }

  async deleteMany(keys: string[], opts?: DeleteManyOptions): Promise<DeleteManyResult> {
    // Fan out with Promise.allSettled — delete is idempotent in memory driver.
    const results = await Promise.allSettled(
      keys.map(async (key) => {
        opts?.signal?.throwIfAborted();
        await this.delay();
        this.store.delete(key);
        return key;
      }),
    );

    const deleted: string[] = [];
    const failed: Array<{ key: string; error: unknown }> = [];

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
    await this.delay();
    return this.store.has(key);
  }

  async stat(key: string, opts?: StatOptions): Promise<StorageObject> {
    opts?.signal?.throwIfAborted();
    await this.delay();
    const entry = this.store.get(key);
    if (!entry) throw new ObjectNotFoundError(key, this.name);
    return {
      key,
      size: entry.data.byteLength,
      lastModified: entry.uploadedAt,
      ...(entry.metadata && { metadata: entry.metadata }),
    };
  }

  getUrl(key: string): string {
    return `memory://${key}`;
  }

  async copy(sourceKey: string, destKey: string, opts?: CopyOptions): Promise<void> {
    opts?.signal?.throwIfAborted();
    await this.delay();
    const entry = this.store.get(sourceKey);
    if (!entry) throw new ObjectNotFoundError(sourceKey, this.name);
    const resolvedMetadata = opts?.metadata ?? entry.metadata;
    this.store.set(destKey, {
      data: Buffer.from(entry.data),
      ...(entry.contentType !== undefined && { contentType: entry.contentType }),
      ...(resolvedMetadata !== undefined && { metadata: resolvedMetadata }),
      uploadedAt: new Date(),
    });
  }

  async move(sourceKey: string, destKey: string, opts?: MoveOptions): Promise<void> {
    opts?.signal?.throwIfAborted();
    await this.delay();
    const entry = this.store.get(sourceKey);
    if (!entry) throw new ObjectNotFoundError(sourceKey, this.name);
    const resolvedMetadata = opts?.metadata ?? entry.metadata;
    this.store.set(destKey, {
      data: Buffer.from(entry.data),
      ...(entry.contentType !== undefined && { contentType: entry.contentType }),
      ...(resolvedMetadata !== undefined && { metadata: resolvedMetadata }),
      uploadedAt: new Date(),
    });
    this.store.delete(sourceKey);
  }

  async listPage(opts?: ListOptions): Promise<ListPage> {
    opts?.signal?.throwIfAborted();
    await this.delay();
    const prefix = opts?.prefix ?? '';
    const limit = opts?.limit;
    const afterKey = opts?.cursor ?? '';
    const items: StorageObject[] = [];

    for (const [key, entry] of this.store) {
      if (prefix && !key.startsWith(prefix)) continue;
      if (afterKey && key <= afterKey) continue;
      items.push({
        key,
        size: entry.data.byteLength,
        lastModified: entry.uploadedAt,
        ...(entry.metadata && { metadata: entry.metadata }),
      });
      if (limit !== undefined && items.length >= limit) {
        return { items, nextCursor: key };
      }
    }

    return { items };
  }

  async getSignedUrl(key: string, opts?: SignedUrlOptions): Promise<string> {
    if (opts?.operation === 'delete') {
      throw new StorageOperationError(
        'MemoryDriver does not support signed URLs for delete operations — memory has no URL concept.',
        this.name,
      );
    }
    await this.delay();
    // No network presence — return a deterministic fake URL for test assertions.
    const expiresAt = Date.now() + (opts?.expiresInSeconds ?? 3600) * 1000;
    const op = opts?.operation ?? 'read';
    return `memory://${key}?op=${op}&expires=${expiresAt}`;
  }

  async *list(opts?: ListOptions): AsyncIterable<StorageObject> {
    opts?.signal?.throwIfAborted();
    await this.delay();
    const prefix = opts?.prefix ?? '';
    const limit = opts?.limit;
    let count = 0;

    for (const [key, entry] of this.store) {
      if (limit !== undefined && count >= limit) return;
      if (prefix && !key.startsWith(prefix)) continue;
      yield {
        key,
        size: entry.data.byteLength,
        lastModified: entry.uploadedAt,
        ...(entry.metadata && { metadata: entry.metadata }),
      };
      count++;
    }
  }

  /** Returns a snapshot of the current store — useful in tests for asserting what was stored. */
  _dump(): Map<string, { data: Buffer; contentType?: string; metadata?: ObjectMetadata; uploadedAt: Date }> {
    return new Map(this.store);
  }

  /** Wipes all stored objects — useful for resetting state between tests. */
  _clear(): void {
    this.store.clear();
  }
}
