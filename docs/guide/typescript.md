# TypeScript

## Generic StorageClient

`StorageClient<D>` is generic over the driver type. In most cases TypeScript infers it:

```typescript
import { StorageClient } from '@restrella/blobpipe'
import { S3Driver } from '@restrella/blobpipe-s3'

const storage = new StorageClient(new S3Driver({ bucket: 'my-bucket', region: 'us-east-1' }))
// storage: StorageClient<S3Driver>
```

You can use `StorageClient<StorageDriver>` (the base interface) when you want driver-agnostic typing:

```typescript
import { StorageClient, type StorageDriver } from '@restrella/blobpipe'

function createStorage(driver: StorageDriver): StorageClient<StorageDriver> {
  return new StorageClient(driver)
}
```

## Escape hatch to driver-specific API

`getDriver()` gives you back the typed driver if you need a driver-specific API that isn't on `StorageClient`:

```typescript
import { StorageClient } from '@restrella/blobpipe'
import { S3Driver } from '@restrella/blobpipe-s3'

const storage = new StorageClient(new S3Driver({ bucket: 'my-bucket', region: 'us-east-1' }))

// Access the underlying S3Driver if needed
const driver = storage.getDriver() // typed as S3Driver
```

Note: accessing the driver directly bypasses the middleware pipeline.

## Factory function pattern

A common pattern for dependency injection and testing:

```typescript
import { StorageClient, type StorageDriver } from '@restrella/blobpipe'
import { logUploads, validateMimeType } from '@restrella/blobpipe'

function createStorageClient(driver: StorageDriver): StorageClient {
  return new StorageClient(driver)
    .use(logUploads({ format: 'json' }))
    .use(validateMimeType({ allowed: ['image/png', 'image/jpeg', 'image/webp'] }))
}

// Production
import { S3Driver } from '@restrella/blobpipe-s3'
const prod = createStorageClient(new S3Driver({ bucket: 'prod-bucket', region: 'us-east-1' }))

// Tests
import { MemoryDriver } from '@restrella/blobpipe-memory'
const test = createStorageClient(new MemoryDriver())
```

## UploadBody

`UploadBody` is the union of all accepted body types for `put()`:

```typescript
type UploadBody = Buffer | Uint8Array | Readable | string
```

Use it to type upload utilities:

```typescript
import type { UploadBody } from '@restrella/blobpipe'

async function uploadWithRetry(
  storage: StorageClient,
  key: string,
  body: UploadBody,
): Promise<PutResult> {
  // ...
}
```

## PutOptions and PutResult

```typescript
import type { PutOptions, PutResult } from '@restrella/blobpipe'

async function upload(key: string, data: UploadBody, opts?: PutOptions): Promise<PutResult> {
  return storage.put(key, data, opts)
}
```

## StorageObject

Returned by `stat()` and yielded by `list()` / `listPage()`:

```typescript
interface StorageObject {
  key: string
  size: number
  lastModified: Date
  etag?: string
  metadata?: Record<string, string>
}
```

## exactOptionalPropertyTypes

blobpipe is compatible with `"exactOptionalPropertyTypes": true` in your `tsconfig.json`. All optional properties use `?: T` (not `?: T | undefined`), so you can safely enable this strict mode without type errors.

## Middleware typing

Custom middleware is typed as `Middleware`:

```typescript
import type { Middleware, UploadContext } from '@restrella/blobpipe'

const addTimestamp: Middleware = async (ctx: UploadContext, next) => {
  ctx.options.metadata = {
    ...ctx.options.metadata,
    uploadedAt: new Date().toISOString(),
  }
  await next()
}
```

For configurable middleware, use `MiddlewareFactory`:

```typescript
import type { MiddlewareFactory } from '@restrella/blobpipe'

interface MyOptions {
  prefix: string
}

const prefixKey: MiddlewareFactory<MyOptions> = (opts) => async (ctx, next) => {
  ctx.key = `${opts.prefix}/${ctx.key}`
  await next()
}

storage.use(prefixKey({ prefix: 'user-123' }))
```

## await using (TypeScript 5.2+)

`StorageClient` implements `Symbol.asyncDispose`, so you can use the `await using` syntax:

```typescript
async function processFile() {
  await using storage = new StorageClient(new S3Driver({ bucket: 'b', region: 'us-east-1' }))
  // storage.dispose() is called automatically when the block exits
  await storage.put('file.txt', 'hello')
}
```
