# Custom Drivers

Implement `StorageDriver` to add a new backend — SFTP, a custom HTTP store, a database-backed store, or a proxy that wraps multiple providers.

## Minimal skeleton

```typescript
import type { Readable } from 'node:stream'
import type {
  StorageDriver,
  UploadBody,
  PutOptions,
  PutResult,
  GetOptions,
  DeleteOptions,
  ExistsOptions,
  StatOptions,
  StorageObject,
  SignedUrlOptions,
  CopyOptions,
  MoveOptions,
  ListOptions,
  ListPage,
  DeleteManyOptions,
  DeleteManyResult,
} from '@blobpipe/core'
import {
  ObjectNotFoundError,
  StorageOperationError,
  InvalidKeyError,
} from '@blobpipe/core'

export class MyDriver implements StorageDriver {
  readonly name = 'my-driver'

  async put(key: string, data: UploadBody, opts?: PutOptions): Promise<PutResult> {
    // Store data under key.
    // Return key, uploadedAt, and optionally size/etag/checksum.
    return {
      key,
      uploadedAt: new Date(),
      // size, etag, checksum are optional
    }
  }

  async get(key: string, opts?: GetOptions): Promise<Readable> {
    // Retrieve the object.
    // Throw ObjectNotFoundError if key does not exist.
    // Respect opts.start / opts.end for byte-range reads.
    throw new ObjectNotFoundError(key, this.name)
  }

  async delete(key: string, opts?: DeleteOptions): Promise<void> {
    // Delete the object.
    // Must be idempotent — do NOT throw if the key doesn't exist.
  }

  async exists(key: string, opts?: ExistsOptions): Promise<boolean> {
    return false
  }

  async stat(key: string, opts?: StatOptions): Promise<StorageObject> {
    // Return metadata without downloading content.
    // Throw ObjectNotFoundError if key does not exist.
    throw new ObjectNotFoundError(key, this.name)
  }

  getUrl(key: string): string {
    // Return the permanent public URL for key.
    // If this concept doesn't apply, throw or return a placeholder.
    return `https://my-storage.example.com/${key}`
  }

  async getSignedUrl(key: string, opts?: SignedUrlOptions): Promise<string> {
    // Generate a time-limited URL.
    // Throw StorageOperationError if signing is not supported.
    throw new StorageOperationError('Signed URLs not supported', this.name)
  }

  async copy(sourceKey: string, destKey: string, opts?: CopyOptions): Promise<void> {
    // Copy object. Throw ObjectNotFoundError if sourceKey doesn't exist.
  }

  async move(sourceKey: string, destKey: string, opts?: MoveOptions): Promise<void> {
    // Move object. Prefer atomic rename where possible; otherwise copy + delete.
    await this.copy(sourceKey, destKey, opts)
    await this.delete(sourceKey)
  }

  async listPage(opts?: ListOptions): Promise<ListPage> {
    // Return one page of objects, optionally filtered by prefix and cursor.
    return { items: [] }
  }

  async *list(opts?: ListOptions): AsyncIterable<StorageObject> {
    // Iterate all objects, handling pagination internally.
    let cursor: string | undefined
    do {
      const page = await this.listPage({ ...opts, cursor })
      for (const item of page.items) yield item
      cursor = page.nextCursor
    } while (cursor !== undefined)
  }

  async deleteMany(keys: string[], opts?: DeleteManyOptions): Promise<DeleteManyResult> {
    // Delete multiple keys. Fan out if no native bulk-delete API exists.
    const results = await Promise.allSettled(
      keys.map((key) => this.delete(key, { signal: opts?.signal }))
    )
    const deleted: string[] = []
    const failed: Array<{ key: string; error: unknown }> = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') deleted.push(keys[i]!)
      else failed.push({ key: keys[i]!, error: r.reason })
    })
    return { deleted, failed }
  }
}
```

## Implementation contract

### `put()`
- Accept `UploadBody` (Buffer, Uint8Array, Readable, string) and store it under `key`.
- Respect `opts.ifNoneMatch: '*'` — throw `ObjectAlreadyExistsError` if the key already exists.
- Respect `opts.signal` — abort the operation when triggered.
- Call `opts.onProgress?.(transferred, total)` periodically during upload if feasible.

### `get()`
- Throw `ObjectNotFoundError` if the key does not exist.
- Respect `opts.start` / `opts.end` for byte-range reads (both inclusive).
- Respect `opts.signal`.

### `delete()`
- **Must be idempotent.** Deleting a non-existent key should succeed silently.
- Respect `opts.signal`.

### `stat()`
- Throw `ObjectNotFoundError` if the key does not exist.
- Return `size`, `lastModified`, and optionally `etag` and `metadata`.

### `list()` / `listPage()`
- `list()` iterates all matching objects; handle pagination internally.
- `listPage()` returns a page with an optional `nextCursor` for the next call.
- `prefix` should filter by key prefix (empty string = all keys).

### Error mapping

Translate provider-specific errors into blobpipe errors:

```typescript
function mapError(err: unknown, key: string, driver: string): never {
  if (isNotFoundError(err)) throw new ObjectNotFoundError(key, driver, { cause: err })
  if (isPermissionError(err)) throw new AccessDeniedError(key, driver, { cause: err })
  if (isInvalidKeyError(err)) throw new InvalidKeyError(key, 'key contains invalid characters', driver, { cause: err })
  throw new StorageOperationError(`Operation failed: ${String(err)}`, driver, { cause: err })
}
```

## Disposable

If your driver holds connections that need teardown, implement `Disposable`:

```typescript
import type { Disposable } from '@blobpipe/core'

export class MyDriver implements StorageDriver, Disposable {
  private client: SomeSDKClient

  async dispose(): Promise<void> {
    await this.client.close()
  }
}
```

`StorageClient.dispose()` will call this automatically.

## Using StorageDriverDecorator

If you only need to override some methods, extend `StorageDriverDecorator`:

```typescript
import { StorageDriverDecorator } from '@blobpipe/core'

export class PrefixingDriver extends StorageDriverDecorator {
  readonly name: string

  constructor(inner: StorageDriver, private readonly prefix: string) {
    super(inner)
    this.name = `prefixing(${inner.name})`
  }

  override put(key: string, data: UploadBody, opts?: PutOptions): Promise<PutResult> {
    return this.inner.put(`${this.prefix}/${key}`, data, opts)
  }

  override get(key: string, opts?: GetOptions): Promise<Readable> {
    return this.inner.get(`${this.prefix}/${key}`, opts)
  }

  // All other methods pass through to this.inner unchanged
}
```
