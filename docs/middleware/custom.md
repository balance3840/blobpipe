# Custom Middleware

## Example 1: Add timestamp metadata

Automatically tags every upload with the current ISO timestamp:

```typescript
import type { Middleware } from '@restrella/blobpipe'

const addTimestampMetadata: Middleware = async (ctx, next) => {
  ctx.options.metadata = {
    ...ctx.options.metadata,
    uploadedAt: new Date().toISOString(),
  }
  await next()
}

storage.use(addTimestampMetadata)
```

After `put()`, the object's metadata will contain `{ uploadedAt: '2024-01-15T10:30:00.000Z' }` alongside any caller-provided metadata.

## Example 2: Virus-scan placeholder

An "around" middleware that intercepts the body, scans it, and only calls `next()` if the scan passes:

```typescript
import type { Middleware } from '@restrella/blobpipe'
import { MiddlewareRejectionError } from '@restrella/blobpipe'
import { Readable } from 'node:stream'

async function scanBuffer(buf: Buffer): Promise<{ clean: boolean; reason?: string }> {
  // Replace with your actual scanner (ClamAV, VirusTotal, etc.)
  return { clean: true }
}

async function readBody(body: import('@restrella/blobpipe').UploadBody): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body
  if (body instanceof Uint8Array) return Buffer.from(body)
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  const chunks: Buffer[] = []
  for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

const virusScan: Middleware = async (ctx, next) => {
  const buffer = await readBody(ctx.body)
  const result = await scanBuffer(buffer)

  if (!result.clean) {
    throw new MiddlewareRejectionError(
      `Upload rejected: malware detected${result.reason ? ` (${result.reason})` : ''}.`,
      'MALWARE_DETECTED',
    )
  }

  // Replace body with the buffered version so the driver doesn't re-read the stream
  ctx.body = buffer
  await next()
}

storage.use(virusScan)
```

## Example 3: Conditional middleware

Apply middleware only when certain conditions are met:

```typescript
import type { MiddlewareFactory, Middleware } from '@restrella/blobpipe'

interface ConditionalOptions {
  when: (ctx: import('@restrella/blobpipe').UploadContext) => boolean
  middleware: Middleware
}

const conditional: MiddlewareFactory<ConditionalOptions> = (opts) => async (ctx, next) => {
  if (opts.when(ctx)) {
    // Delegate to the wrapped middleware
    await opts.middleware(ctx, next)
  } else {
    await next()
  }
}

// Only validate MIME type for keys under "images/"
storage.use(
  conditional({
    when: (ctx) => ctx.key.startsWith('images/'),
    middleware: validateMimeType({ allowed: ['image/png', 'image/jpeg', 'image/webp'] }),
  })
)
```

## Example 4: Request context injection

Pass per-request data from the caller into the middleware chain via `ctx.locals`:

```typescript
import type { Middleware } from '@restrella/blobpipe'

// Middleware reads userId from locals and attaches it as metadata
const attachUserId: Middleware = async (ctx, next) => {
  const userId = ctx.locals.userId as string | undefined
  if (userId) {
    ctx.options.metadata = { ...ctx.options.metadata, uploadedBy: userId }
  }
  await next()
}

storage.use(attachUserId)

// Caller sets locals before calling put() — not currently supported directly,
// but you can extend StorageClient or pass userId via metadata in options:
await storage.put('avatar.jpg', buffer, {
  contentType: 'image/jpeg',
  metadata: { uploadedBy: 'user-123' },
})
```

## Middleware that reads the result

Post-processing that runs after the driver has stored the file:

```typescript
import type { Middleware } from '@restrella/blobpipe'

const webhookOnUpload: Middleware = async (ctx, next) => {
  await next()
  // ctx.result is now populated
  const { key, size, etag } = ctx.result!

  // Fire-and-forget webhook (don't await — don't block the upload response)
  fetch('https://hooks.example.com/storage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, size, etag }),
  }).catch(console.error)
}

storage.use(webhookOnUpload)
```

## Guidelines

- **Call `next()` exactly once** unless you're intentionally short-circuiting (rejection). Not calling `next()` skips the driver entirely and will cause `StorageClient` to throw.
- **Replace streams with buffers** after consuming them. If you read a `Readable` body (e.g. for scanning), replace `ctx.body` with the collected `Buffer` so downstream middleware doesn't try to read an exhausted stream.
- **Throw `MiddlewareRejectionError`** for user-facing rejection reasons (wrong MIME type, file too large, policy violation). This tells callers "your input was rejected" rather than "the storage backend failed."
- **Mutate `ctx.options`, not `opts`**. The `options` object passed to `put()` is spread into `ctx.options` — mutating `ctx.options` is safe and scoped to one request.
