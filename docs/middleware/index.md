# Middleware

Middleware is an ordered pipeline that runs on every `put()` call. Use it for validation, transformation, and side effects on uploads.

## How it works

Each middleware is a function with this signature:

```typescript
type Middleware = (ctx: UploadContext, next: () => Promise<void>) => Promise<void>
```

Call `next()` to pass control to the next middleware in the chain. When `next()` returns, the driver has already stored the file and `ctx.result` is populated.

**Don't call `next()`** to short-circuit the pipeline — use this for rejection logic.

## UploadContext

```typescript
interface UploadContext {
  key: string                        // the storage key
  body: UploadBody                   // the payload — you may replace this
  options: PutOptions                // put options — you may mutate this
  result?: PutResult                 // populated after driver.put() — undefined during pre phase
  locals: Record<string, unknown>    // pass data between middlewares
}
```

Fields you can mutate:

- `ctx.key` — rename the key before it reaches the driver
- `ctx.body` — replace the body (e.g. compress or resize it)
- `ctx.options` — add/change metadata, contentType, etc.
- `ctx.locals` — store data for downstream middlewares

## Attaching middleware

```typescript
import { StorageClient, logUploads, maxFileSize, validateMimeType } from '@blobpipe/core'

const storage = new StorageClient(driver)
  .use(validateMimeType({ allowed: ['image/png', 'image/jpeg'] }))
  .use(maxFileSize({ maxBytes: 5 * 1024 * 1024 }))
  .use(logUploads())
```

`.use()` is **immutable** — it returns a new `StorageClient` with the middleware appended. The original is unchanged:

```typescript
const base = new StorageClient(driver).use(logUploads())
const strict = base.use(validateMimeType({ allowed: ['image/png'] }))
// base still only has logUploads
// strict has logUploads + validateMimeType
```

## Execution order

Middlewares run in registration order. Think of them as nested wrappers:

```
validateMimeType  →  maxFileSize  →  logUploads  →  driver
      ↑                  ↑               ↑
   (await next())    (await next())  (await next())
      ↓                  ↓               ↓
(post, ctx.result)  (post, ctx.result) (post, ctx.result)
```

Register validation **before** logging so the logger sees actual rejections:

```typescript
// Good — validation first, logger wraps everything
const storage = new StorageClient(driver)
  .use(validateMimeType({ allowed: ['image/png'] }))
  .use(maxFileSize({ maxBytes: 5 * 1024 * 1024 }))
  .use(logUploads())  // wraps the outer layer — sees success and failure
```

## Rejecting uploads

Throw `MiddlewareRejectionError` to reject an upload with a machine-readable code:

```typescript
import { MiddlewareRejectionError } from '@blobpipe/core'

const rejectSvg: Middleware = async (ctx, next) => {
  if (ctx.options.contentType === 'image/svg+xml') {
    throw new MiddlewareRejectionError(
      `SVG uploads are not allowed for security reasons.`,
      'SVG_NOT_ALLOWED',
    )
  }
  await next()
}
```

The caller catches it as:

```typescript
import { MiddlewareRejectionError } from '@blobpipe/core'

try {
  await storage.put('image.svg', data, { contentType: 'image/svg+xml' })
} catch (err) {
  if (err instanceof MiddlewareRejectionError) {
    console.log(err.code)    // 'SVG_NOT_ALLOWED'
    console.log(err.message) // 'SVG uploads are not allowed for security reasons.'
  }
}
```

## Writing custom middleware

```typescript
import type { Middleware } from '@blobpipe/core'

// Simple "pre" middleware — runs before the driver
const addUploadedBy: Middleware = async (ctx, next) => {
  ctx.options.metadata = {
    ...ctx.options.metadata,
    uploadedBy: 'system',
  }
  await next()
}

// "Around" middleware — wraps the driver call
const timeUpload: Middleware = async (ctx, next) => {
  const start = Date.now()
  await next()
  console.log(`${ctx.key} stored in ${Date.now() - start}ms`)
}

// Configurable middleware using MiddlewareFactory
import type { MiddlewareFactory } from '@blobpipe/core'

interface AddTagOptions {
  tag: string
}

const addTag: MiddlewareFactory<AddTagOptions> = (opts) => async (ctx, next) => {
  ctx.options.metadata = { ...ctx.options.metadata, tag: opts.tag }
  await next()
}

storage.use(addTag({ tag: 'user-upload' }))
```

## Passing data between middlewares

Use `ctx.locals` to pass data between steps:

```typescript
const trackRequest: Middleware = async (ctx, next) => {
  ctx.locals.requestId = crypto.randomUUID()
  await next()
}

const logWithRequestId: Middleware = async (ctx, next) => {
  await next()
  console.log(`[${ctx.locals.requestId}] stored ${ctx.key}`)
}

storage.use(trackRequest).use(logWithRequestId)
```
