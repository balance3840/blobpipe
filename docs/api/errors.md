# Errors

All errors extend `StorageError`. Import from `@restrella/blobpipe`.

```typescript
import {
  StorageError,
  ObjectNotFoundError,
  ObjectAlreadyExistsError,
  AccessDeniedError,
  InvalidKeyError,
  StorageOperationError,
  DriverConfigurationError,
  MiddlewareRejectionError,
} from '@restrella/blobpipe'
```

## StorageError (abstract)

Base class for all storage errors.

```typescript
abstract class StorageError extends Error {
  abstract readonly driver: string  // e.g. "s3", "azure-blob", "memory"
  readonly cause?: unknown           // original provider error
}
```

Use `instanceof StorageError` as a catch-all for any blobpipe error:

```typescript
try {
  await storage.get('file.jpg')
} catch (err) {
  if (err instanceof StorageError) {
    console.error(`[${err.driver}] ${err.message}`, err.cause)
  }
}
```

---

## ObjectNotFoundError

Thrown when a key does not exist.

**Operations that can throw:** `get`, `stat`, `copy`, `move`

```typescript
class ObjectNotFoundError extends StorageError {
  readonly key: string     // the key that was not found
  readonly driver: string
}
```

```typescript
import { ObjectNotFoundError } from '@restrella/blobpipe'

try {
  const stream = await storage.get('missing/file.jpg')
} catch (err) {
  if (err instanceof ObjectNotFoundError) {
    console.log(err.key)    // 'missing/file.jpg'
    console.log(err.driver) // 'gcs'
    // Return HTTP 404
  }
}
```

---

## ObjectAlreadyExistsError

Thrown when `put()` is called with `ifNoneMatch: '*'` and the key already exists.

**Operations that can throw:** `put` (only when `ifNoneMatch: '*'`)

```typescript
class ObjectAlreadyExistsError extends StorageError {
  readonly driver: string
  readonly code = 'OBJECT_ALREADY_EXISTS'
}
```

```typescript
import { ObjectAlreadyExistsError } from '@restrella/blobpipe'

try {
  await storage.put('config.json', data, {
    contentType: 'application/json',
    ifNoneMatch: '*',
  })
} catch (err) {
  if (err instanceof ObjectAlreadyExistsError) {
    // Key already exists — handle conflict
  }
}
```

---

## AccessDeniedError

Thrown when the caller lacks permission for the requested operation.

**Operations that can throw:** any driver operation

```typescript
class AccessDeniedError extends StorageError {
  readonly key: string
  readonly driver: string
}
```

```typescript
import { AccessDeniedError } from '@restrella/blobpipe'

try {
  await storage.get('private/secret.pdf')
} catch (err) {
  if (err instanceof AccessDeniedError) {
    // Return HTTP 403
  }
}
```

---

## InvalidKeyError

Thrown when a key is malformed or contains characters that are illegal for the storage backend (e.g. path traversal in `LocalDriver`, control characters in S3).

**Operations that can throw:** any driver operation

```typescript
class InvalidKeyError extends StorageError {
  readonly key: string
  readonly driver: string
}
```

The error message includes the specific reason:

```typescript
try {
  await storage.get('../../etc/passwd')
} catch (err) {
  if (err instanceof InvalidKeyError) {
    console.log(err.message) // 'Invalid key "../../etc/passwd": path traversal detected'
  }
}
```

---

## StorageOperationError

Thrown for all other failures: network errors, timeouts, rate limits, malformed provider responses.

**Operations that can throw:** any driver operation

```typescript
class StorageOperationError extends StorageError {
  readonly driver: string
}
```

```typescript
import { StorageOperationError } from '@restrella/blobpipe'

try {
  await storage.put('file.jpg', data, { contentType: 'image/jpeg' })
} catch (err) {
  if (err instanceof StorageOperationError) {
    // Return HTTP 502 — storage backend unavailable
    console.error(err.message, err.cause)
  }
}
```

---

## DriverConfigurationError

Thrown when the driver is misconfigured — bad bucket name, invalid credentials format, missing required config. Usually thrown at construction time or on the first operation.

```typescript
class DriverConfigurationError extends StorageError {
  readonly driver: string
}
```

```typescript
import { DriverConfigurationError } from '@restrella/blobpipe'

try {
  const driver = new S3Driver({ bucket: '', region: 'us-east-1' }) // invalid
} catch (err) {
  if (err instanceof DriverConfigurationError) {
    console.error('Driver misconfiguration:', err.message)
    process.exit(1)
  }
}
```

---

## MiddlewareRejectionError

Thrown by middleware to halt the pipeline with a machine-readable code. This is not a `StorageError` — it signals that the upload was rejected by application logic, not by the storage backend.

```typescript
class MiddlewareRejectionError extends Error {
  readonly code: string               // e.g. 'DISALLOWED_CONTENT_TYPE', 'FILE_TOO_LARGE'
  readonly metadata?: Record<string, string>  // optional structured data
}
```

Built-in codes:

| Code | Thrown by |
|---|---|
| `MISSING_CONTENT_TYPE` | `validateMimeType` — `contentType` not provided |
| `DISALLOWED_CONTENT_TYPE` | `validateMimeType` — MIME type not in allowed list |
| `FILE_TOO_LARGE` | `maxFileSize` — body exceeds `maxBytes` |

```typescript
import { MiddlewareRejectionError } from '@restrella/blobpipe'

try {
  await storage.put('file.exe', data, { contentType: 'application/octet-stream' })
} catch (err) {
  if (err instanceof MiddlewareRejectionError) {
    console.log(err.code)    // 'DISALLOWED_CONTENT_TYPE'
    console.log(err.message) // full human-readable explanation
    // Return HTTP 422
  }
}
```

## Error hierarchy summary

```
Error
├── StorageError (abstract) — base for all driver errors
│   ├── ObjectNotFoundError       key does not exist
│   ├── ObjectAlreadyExistsError  ifNoneMatch: '*' conflict
│   ├── AccessDeniedError         permission denied
│   ├── InvalidKeyError           malformed key
│   ├── StorageOperationError     network/timeout/unexpected failure
│   └── DriverConfigurationError  misconfigured driver
└── MiddlewareRejectionError      upload rejected by middleware (not a StorageError)
```
