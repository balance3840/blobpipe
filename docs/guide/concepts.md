# Concepts

blobpipe is built on three design patterns that work together:

## Architecture overview

```
                  ┌─────────────────────────────────────────────┐
                  │              StorageClient                   │
                  │                                              │
  put()  ──────►  │  Middleware 1 → Middleware 2 → Middleware N  │──► driver.put()
                  │                                              │
  get()  ──────►  │  (passes through directly, no middleware)    │──► driver.get()
  stat() ──────►  │                                              │──► driver.stat()
  ...             └─────────────────────────────────────────────┘
                                                │
                                      ┌─────────▼──────────┐
                                      │   StorageDriver     │
                                      │  (Strategy pattern) │
                                      └─────────┬──────────┘
                                                │
                        ┌───────────────────────┼───────────────────┐
                        │           │           │           │        │
                    S3Driver   GcsDriver  AzureBlob  LocalDriver  MemoryDriver
```

## Strategy — StorageDriver

Every storage backend implements `StorageDriver`. Swap backends by passing a different driver to `StorageClient` — zero application code changes required.

```typescript
interface StorageDriver {
  readonly name: string
  put(key: string, data: UploadBody, opts?: PutOptions): Promise<PutResult>
  get(key: string, opts?: GetOptions): Promise<Readable>
  delete(key: string, opts?: DeleteOptions): Promise<void>
  exists(key: string, opts?: ExistsOptions): Promise<boolean>
  stat(key: string, opts?: StatOptions): Promise<StorageObject>
  getUrl(key: string): string
  getSignedUrl(key: string, opts?: SignedUrlOptions): Promise<string>
  copy(sourceKey: string, destKey: string, opts?: CopyOptions): Promise<void>
  move(sourceKey: string, destKey: string, opts?: MoveOptions): Promise<void>
  listPage(opts?: ListOptions): Promise<ListPage>
  list(opts?: ListOptions): AsyncIterable<StorageObject>
  deleteMany(keys: string[], opts?: DeleteManyOptions): Promise<DeleteManyResult>
}
```

The interface is intentionally small and provider-agnostic. Provider-specific options (S3 storage classes, Azure access tiers) live in each driver's config type, not here.

## Chain of Responsibility — Middleware

Middleware forms an ordered pipeline that runs **only on `put()`** calls. Each step receives a mutable `UploadContext` and a `next()` function to continue the chain.

```typescript
type Middleware = (ctx: UploadContext, next: () => Promise<void>) => Promise<void>

interface UploadContext {
  key: string            // the storage key
  body: UploadBody       // the payload — middlewares may replace this
  options: PutOptions    // put options — middlewares may mutate this
  result?: PutResult     // populated after the driver runs
  locals: Record<string, unknown>  // pass data between middlewares
}
```

**Why only `put()`?** Validation, transformation, and scanning concerns apply to incoming data. Reads, lists, and deletes pass straight through to the driver — there's nothing to intercept.

**Execution order:**

```
client.put()
  → middleware[0] (pre-driver phase)
    → middleware[1] (pre-driver phase)
      → driver.put()   ← ctx.result is populated here
    ← middleware[1] (post-driver phase — ctx.result available)
  ← middleware[0] (post-driver phase — ctx.result available)
```

Middlewares that need to act _after_ the driver (e.g. logging) call `next()` first, then read `ctx.result` on the way back:

```typescript
return async (ctx, next) => {
  const start = Date.now()
  await next()                            // driver runs here
  console.log(`stored in ${Date.now() - start}ms`, ctx.result?.size)
}
```

## Decorator — RetryingDriver / InstrumentedDriver

Decorators wrap a `StorageDriver` and intercept **all** operations, not just `put()`. They're for infrastructure concerns: retries, metrics, tracing.

```typescript
import { RetryingDriver, InstrumentedDriver } from '@blobpipe/core'
import { S3Driver } from '@blobpipe/s3'

const base = new S3Driver({ bucket: 'my-bucket', region: 'us-east-1' })

const withMetrics = new InstrumentedDriver(base, {
  onOperation: ({ operation, durationMs, error }) => {
    metrics.histogram('storage.op', durationMs, { operation, ok: !error })
  },
})

const withRetry = new RetryingDriver(withMetrics, { maxAttempts: 3 })

const storage = new StorageClient(withRetry)
```

**Middleware vs. Decorator — when to use which:**

| Concern | Use |
|---|---|
| Validate upload content/type/size | Middleware |
| Transform the body before storing | Middleware |
| Log upload outcomes | Middleware (`logUploads`) or Decorator |
| Retry transient failures on all ops | Decorator (`RetryingDriver`) |
| Emit metrics/traces for all ops | Decorator (`InstrumentedDriver`) |
