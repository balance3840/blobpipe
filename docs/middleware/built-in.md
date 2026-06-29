# Built-in Middleware

All built-in middleware is exported from `@restrella/blobpipe`.

## validateMimeType

Rejects uploads whose declared `contentType` is not in an allowed list.

```typescript
import { validateMimeType } from '@restrella/blobpipe'

storage.use(validateMimeType({ allowed: ['image/png', 'image/jpeg', 'image/webp'] }))
```

**Options:**

| Option | Type | Description |
|---|---|---|
| `allowed` | `string[]` | Allowed MIME types. Parameters (e.g. `image/png; charset=utf-8`) are stripped before matching. |

**Throws** `MiddlewareRejectionError` with:
- `MISSING_CONTENT_TYPE` — when `options.contentType` is not set
- `DISALLOWED_CONTENT_TYPE` — when the content type is not in `allowed`

::: info Content-type sniffing
This middleware validates the **declared** content type only — it does not read file bytes. Pair with `sniffMimeType` (placed before `validateMimeType`) to guard against spoofed content types:
:::

```typescript
import { sniffMimeType, validateMimeType } from '@restrella/blobpipe'

storage
  .use(sniffMimeType())                                          // detects actual type from bytes
  .use(validateMimeType({ allowed: ['image/png', 'image/jpeg'] })) // validates detected type
```

---

## maxFileSize

Rejects uploads that exceed a byte limit.

```typescript
import { maxFileSize } from '@restrella/blobpipe'

storage.use(maxFileSize({ maxBytes: 10 * 1024 * 1024 })) // 10 MB
```

**Options:**

| Option | Type | Description |
|---|---|---|
| `maxBytes` | `number` | Maximum allowed payload size in bytes |

**Throws** `MiddlewareRejectionError` with code `FILE_TOO_LARGE`.

**Stream handling:** For `Readable` stream bodies, the stream is consumed and buffered up to `maxBytes`. If the limit is crossed, the upload is rejected immediately. If the limit is not crossed, `ctx.body` is replaced with the buffered `Buffer` so downstream middleware and the driver see a known-length body.

---

## logUploads

Logs the outcome of every upload. Runs as an "around" middleware — calls `next()` first, then reads `ctx.result` to log success, or catches and re-throws to log failures.

```typescript
import { logUploads } from '@restrella/blobpipe'

// Text format (default)
storage.use(logUploads())

// JSON format for log aggregators
storage.use(logUploads({ format: 'json' }))

// Custom logger
storage.use(logUploads({ logger: myLogger }))
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `logger` | `{ info, error }` | `console` | Logger to use. Any object with `info` and `error` methods |
| `format` | `'text' \| 'json'` | `'text'` | Output format |

**Text format output:**

```
[blobpipe] PUT "uploads/photo.jpg" — 48302 bytes in 142ms (etag: "abc123")
[blobpipe] PUT "uploads/file.exe" failed after 3ms — MiddlewareRejectionError: ...
```

**JSON format output:**

Success:
```json
{"level":"info","msg":"blobpipe PUT ok","key":"uploads/photo.jpg","durationMs":142,"size":48302,"etag":"abc123"}
```

Failure:
```json
{"level":"error","msg":"blobpipe PUT failed","key":"uploads/file.exe","durationMs":3,"error":"content type \"application/octet-stream\" is not allowed"}
```

---

## sniffMimeType

Detects the MIME type from file content (magic bytes) and sets `ctx.options.contentType` automatically.

```bash
# Requires a peer dependency
npm install file-type
```

```typescript
import { sniffMimeType } from '@restrella/blobpipe'

storage.use(sniffMimeType())
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `override` | `boolean` | `false` | If `true`, overrides an already-declared `contentType`. If `false` (default), skips sniffing when `contentType` is already set. |

**Behavior:**
- The `file-type` import is kicked off at configuration time and cached. No re-import overhead on subsequent uploads.
- If `file-type` is not installed, the middleware throws a helpful error on the first upload.
- For `Readable` streams: reads up to 4100 bytes, detects type, then reconstructs the stream so the driver sees the full content.
- If the type cannot be detected, `contentType` is not set (the driver may attempt its own sniffing).

**Force override of declared type:**

```typescript
storage.use(sniffMimeType({ override: true }))
// Sets contentType from bytes even if the caller already declared one
```
