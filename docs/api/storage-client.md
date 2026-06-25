# StorageClient

```typescript
import { StorageClient } from '@blobpipe/core'
```

The main entry point. Composes a `StorageDriver` with an ordered middleware pipeline.

## Constructor

```typescript
new StorageClient<D extends StorageDriver>(driver: D, middlewares?: Middleware[])
```

```typescript
import { StorageClient } from '@blobpipe/core'
import { S3Driver } from '@blobpipe/s3'

const storage = new StorageClient(new S3Driver({ bucket: 'my-bucket', region: 'us-east-1' }))
```

## use()

```typescript
use(middleware: Middleware): StorageClient<D>
```

Returns a **new** `StorageClient` that inherits all existing middlewares plus the new one appended at the end. The original instance is not modified.

```typescript
const base = new StorageClient(driver).use(logUploads())
const strict = base.use(validateMimeType({ allowed: ['image/png'] }))
// base: logUploads only
// strict: logUploads + validateMimeType
```

---

## put()

```typescript
put(key: string, data: UploadBody, opts?: PutOptions): Promise<PutResult>
```

Stores `data` under `key`. Runs the middleware pipeline before invoking the driver.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `key` | `string` | Storage key for the object |
| `data` | `UploadBody` | `Buffer \| Uint8Array \| Readable \| string` |
| `opts.contentType` | `string` | MIME type |
| `opts.metadata` | `Record<string, string>` | Arbitrary key-value metadata |
| `opts.access` | `'private' \| 'public-read'` | Access level (default: `'private'`) |
| `opts.signal` | `AbortSignal` | Cancel the operation |
| `opts.storageClass` | `string` | Provider-specific storage class / tier |
| `opts.ifNoneMatch` | `'*'` | Throw `ObjectAlreadyExistsError` if key exists |
| `opts.onProgress` | `(transferred, total?) => void` | Progress callback |

**Returns** `PutResult`:

| Field | Type | Description |
|---|---|---|
| `key` | `string` | The stored key |
| `size` | `number?` | Size in bytes, if known |
| `etag` | `string?` | Entity tag from the provider |
| `uploadedAt` | `Date` | Write timestamp |
| `checksum` | `string?` | Base64-encoded SHA-256, if available |

**Throws:** `MiddlewareRejectionError`, `ObjectAlreadyExistsError`, `AccessDeniedError`, `StorageOperationError`

```typescript
const result = await storage.put('uploads/photo.jpg', buffer, {
  contentType: 'image/jpeg',
  metadata: { uploadedBy: 'user-123' },
  access: 'public-read',
})
console.log(result.key, result.size, result.etag)
```

---

## get()

```typescript
get(key: string, opts?: GetOptions): Promise<Readable>
```

Retrieves the object as a Node.js `Readable` stream.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `key` | `string` | Storage key |
| `opts.signal` | `AbortSignal` | Cancel the operation |
| `opts.start` | `number` | Start byte offset (inclusive) |
| `opts.end` | `number` | End byte offset (inclusive) |

**Throws:** `ObjectNotFoundError`, `AccessDeniedError`, `StorageOperationError`

```typescript
// Full download
const stream = await storage.get('uploads/photo.jpg')
stream.pipe(res)

// Byte range — bytes 0–999 (first kilobyte)
const partial = await storage.get('video.mp4', { start: 0, end: 999 })
```

---

## exists()

```typescript
exists(key: string, opts?: ExistsOptions): Promise<boolean>
```

Returns `true` if an object exists under `key`.

```typescript
const exists = await storage.exists('uploads/photo.jpg') // true | false
```

---

## stat()

```typescript
stat(key: string, opts?: StatOptions): Promise<StorageObject>
```

Returns metadata for an object without downloading its content.

**Returns** `StorageObject`:

| Field | Type | Description |
|---|---|---|
| `key` | `string` | Storage key |
| `size` | `number` | Size in bytes |
| `lastModified` | `Date` | Last modification time |
| `etag` | `string?` | Entity tag |
| `metadata` | `Record<string, string>?` | User-defined metadata |

**Throws:** `ObjectNotFoundError`, `AccessDeniedError`, `StorageOperationError`

```typescript
const obj = await storage.stat('uploads/photo.jpg')
console.log(obj.size, obj.lastModified, obj.metadata)
```

---

## delete()

```typescript
delete(key: string, opts?: DeleteOptions): Promise<void>
```

Deletes the object. **Idempotent** — does not throw if the key does not exist.

```typescript
await storage.delete('uploads/old-photo.jpg')
```

---

## deleteMany()

```typescript
deleteMany(keys: string[], opts?: DeleteManyOptions): Promise<DeleteManyResult>
```

Deletes multiple objects. Uses native bulk-delete where supported (S3); otherwise fans out with a concurrency limit of 10.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `keys` | `string[]` | required | Keys to delete |
| `opts.signal` | `AbortSignal` | — | Cancel the operation |
| `opts.ignoreNotFound` | `boolean` | `true` | Suppress errors for keys that don't exist |

**Returns** `DeleteManyResult`:

```typescript
interface DeleteManyResult {
  deleted: string[]
  failed: Array<{ key: string; error: unknown }>
}
```

```typescript
const { deleted, failed } = await storage.deleteMany(['a.jpg', 'b.jpg', 'c.jpg'])
console.log(`Deleted: ${deleted.length}, Failed: ${failed.length}`)
```

---

## copy()

```typescript
copy(sourceKey: string, destKey: string, opts?: CopyOptions): Promise<void>
```

Copies an object within the same bucket/container.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `sourceKey` | `string` | Key to copy from |
| `destKey` | `string` | Key to copy to |
| `opts.access` | `AccessLevel` | Access level for the destination |
| `opts.metadata` | `ObjectMetadata` | Metadata for the destination (source metadata preserved if omitted) |
| `opts.signal` | `AbortSignal` | Cancel the operation |

**Throws:** `ObjectNotFoundError` if `sourceKey` doesn't exist.

```typescript
await storage.copy('originals/photo.jpg', 'thumbnails/photo.jpg')
```

---

## move()

```typescript
move(sourceKey: string, destKey: string, opts?: MoveOptions): Promise<void>
```

Moves (renames) `sourceKey` to `destKey`. Atomic on providers that support it (local filesystem rename, GCS file.move()); otherwise copy + delete.

```typescript
await storage.move('uploads/temp-abc123.jpg', 'uploads/user-123/avatar.jpg')
```

---

## list()

```typescript
list(opts?: ListOptions): AsyncIterable<StorageObject>
```

Iterates all objects, optionally filtered by prefix. Handles pagination internally.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `opts.prefix` | `string` | Only return keys with this prefix |
| `opts.limit` | `number` | Max objects to return |
| `opts.signal` | `AbortSignal` | Cancel the operation |

```typescript
for await (const obj of storage.list({ prefix: 'uploads/2024/' })) {
  console.log(obj.key, obj.size, obj.lastModified)
}
```

---

## listPage()

```typescript
listPage(opts?: ListOptions): Promise<ListPage>
```

Returns a single page of results with an optional cursor for the next page.

**Returns** `ListPage`:

```typescript
interface ListPage {
  items: StorageObject[]
  nextCursor?: string  // present when more results exist
}
```

```typescript
let cursor: string | undefined

do {
  const page = await storage.listPage({ prefix: 'uploads/', limit: 100, cursor })
  for (const item of page.items) process(item)
  cursor = page.nextCursor
} while (cursor !== undefined)
```

---

## getUrl()

```typescript
getUrl(key: string): string
```

Returns the permanent public URL for `key`. Only valid for publicly accessible objects (`access: 'public-read'`).

```typescript
const url = storage.getUrl('avatars/user-123.jpg')
// => 'https://my-bucket.s3.amazonaws.com/avatars/user-123.jpg'
```

---

## getSignedUrl()

```typescript
getSignedUrl(key: string, opts?: SignedUrlOptions): Promise<string>
```

Generates a time-limited URL granting read, write, or delete access.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `opts.expiresInSeconds` | `number` | `3600` | URL validity duration |
| `opts.operation` | `'read' \| 'write' \| 'delete'` | `'read'` | Access type |
| `opts.contentType` | `string` | — | For write URLs: constrains upload MIME type (S3, GCS) |

```typescript
// Read URL, 15-minute expiry
const readUrl = await storage.getSignedUrl('uploads/photo.jpg', {
  expiresInSeconds: 900,
  operation: 'read',
})

// Write URL with content-type enforcement
const writeUrl = await storage.getSignedUrl('uploads/new.jpg', {
  expiresInSeconds: 300,
  operation: 'write',
  contentType: 'image/jpeg',
})
```

---

## dispose()

```typescript
dispose(): Promise<void>
```

Tears down the underlying driver if it implements `Disposable`. No-op for drivers that don't. Also available as `[Symbol.asyncDispose]()` for `await using` syntax (TypeScript 5.2+).

```typescript
await storage.dispose()

// or with await using (TypeScript 5.2+)
await using storage = new StorageClient(driver)
```

---

## getDriver()

```typescript
getDriver(): D
```

Returns the underlying driver with its concrete type. Use only for driver-specific escape hatches — operations via the driver directly bypass the middleware pipeline.

```typescript
const driver = storage.getDriver() // typed as S3Driver if that's what was passed
```
