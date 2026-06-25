# How blobpipe works

blobpipe has three composable layers. You pick which ones you need.

## The full picture

```
your code
    │
    ▼
StorageClient          ← what you interact with
    │
    ├─ Middleware       ← runs on every put() — validate, transform, log
    │   ├─ validateMimeType
    │   ├─ maxFileSize
    │   └─ logUploads
    │
    └─ Driver           ← talks to the cloud (or disk, or memory)
        └─ RetryingDriver
            └─ InstrumentedDriver
                └─ S3Driver
```

In code, that looks like this:

```typescript
import { StorageClient, validateMimeType, logUploads } from '@restrella/blobpipe'
import { RetryingDriver, InstrumentedDriver }          from '@restrella/blobpipe'
import { S3Driver }                                    from '@restrella/blobpipe-s3'

const storage = new StorageClient(
  new RetryingDriver(
    new InstrumentedDriver(new S3Driver({ bucket: 'my-bucket', region: 'us-east-1' }))
  )
)
  .use(validateMimeType({ allowed: ['image/png', 'image/jpeg'] }))
  .use(logUploads({ format: 'json' }))
```

Every layer is optional. Most apps just need a driver and one or two middlewares.

---

## Drivers — swap the cloud

A driver is the thing that actually talks to S3, GCS, Azure, or your filesystem. Every driver implements the same interface, so your app code never changes when you switch.

```typescript
// dev
const storage = new StorageClient(new LocalDriver({ rootDir: './uploads' }))

// production
const storage = new StorageClient(new S3Driver({ bucket: 'my-bucket', region: 'us-east-1' }))

// tests
const storage = new StorageClient(new MemoryDriver())
```

Same `put`, `get`, `delete`, `list` — regardless of what's underneath.

---

## Middleware — rules for every upload

Middleware runs before every `put()`. It can inspect the file, reject it, transform it, or add metadata. It does not run on reads, deletes, or lists — there's nothing to intercept there.

```typescript
const storage = new StorageClient(driver)
  .use(validateMimeType({ allowed: ['image/png', 'image/jpeg'] }))
  .use(maxFileSize({ maxBytes: 10 * 1024 * 1024 }))
  .use(logUploads())
```

**`use()` returns a new client** — the original is never changed. This means you can safely fork from a shared base:

```typescript
const base   = new StorageClient(driver).use(logUploads())
const images = base.use(validateMimeType({ allowed: ['image/png', 'image/jpeg'] }))
const docs   = base.use(maxFileSize({ maxBytes: 50 * 1024 * 1024 }))
// base is unchanged — only has logUploads
```

The execution order is straightforward — middlewares run in registration order, and after the driver completes you can read the result on the way back:

```
put() called
  → validateMimeType checks the file type
    → maxFileSize checks the size
      → driver stores the file        ← result is populated here
    ← maxFileSize (done)
  ← validateMimeType (done)
← result returned to your code
```

Writing your own middleware is just an async function:

```typescript
import type { Middleware } from '@restrella/blobpipe'

const tagWithVersion: Middleware = async (ctx, next) => {
  ctx.options = {
    ...ctx.options,
    metadata: { ...ctx.options.metadata, version: process.env.APP_VERSION ?? '?' },
  }
  await next()
  console.log(`Stored ${ctx.result?.key} — ${ctx.result?.size} bytes`)
}
```

`ctx.body` is the raw upload data (you can replace it). `ctx.options` is the put options (you can add to it). `ctx.result` is populated after `next()` returns.

---

## Driver wrappers — infrastructure concerns

Some concerns apply to every operation, not just uploads: retrying a failed download, timing how long a `stat()` takes, tracing a `list()` call. For these, you wrap the driver itself.

```typescript
import { RetryingDriver, InstrumentedDriver } from '@restrella/blobpipe'

// Retries any transient failure up to 3 times with exponential backoff
const retrying = new RetryingDriver(driver, {
  maxAttempts: 3,
  baseDelayMs: 200,
})

// Fires a callback after every operation with timing and error info
const instrumented = new InstrumentedDriver(driver, {
  onOperation: ({ operation, durationMs, error }) => {
    metrics.histogram('storage.op', durationMs, { op: operation, ok: !error })
  },
})

// Stack them — innermost wraps the real driver
const storage = new StorageClient(
  new RetryingDriver(new InstrumentedDriver(new S3Driver(config)))
)
```

**When to use middleware vs. a driver wrapper:**

| You want to… | Use |
|---|---|
| Reject files by type, size, or content | Middleware |
| Add metadata to every upload | Middleware |
| Log upload outcomes | Middleware (`logUploads`) |
| Retry any failing operation | Driver wrapper (`RetryingDriver`) |
| Measure timing for all operations | Driver wrapper (`InstrumentedDriver`) |
