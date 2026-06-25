# Error Handling

blobpipe translates provider-specific errors (AWS `NoSuchKey`, Azure `BlobNotFound`, GCS 404) into a normalized error hierarchy. You write error handling once — it works across all providers.

## Error hierarchy

```
Error
└── StorageError (abstract)
    ├── ObjectNotFoundError      — key does not exist
    ├── ObjectAlreadyExistsError — put() with ifNoneMatch: '*' and key exists
    ├── AccessDeniedError        — missing permissions
    ├── InvalidKeyError          — key is malformed or contains illegal characters
    ├── StorageOperationError    — network errors, timeouts, malformed responses
    └── DriverConfigurationError — misconfigured driver (bad bucket name, missing creds)
```

All errors extend `StorageError`, which has:
- `message` — human-readable description
- `driver` — the driver name that threw (e.g. `"s3"`, `"azure-blob"`)
- `cause` — the original provider error, for debugging

## Catching specific errors

```typescript
import {
  ObjectNotFoundError,
  ObjectAlreadyExistsError,
  AccessDeniedError,
  InvalidKeyError,
  StorageOperationError,
  StorageError,
} from '@blobpipe/core'

try {
  const stream = await storage.get('uploads/photo.jpg')
} catch (err) {
  if (err instanceof ObjectNotFoundError) {
    console.log(`Key not found: ${err.key} (driver: ${err.driver})`)
    // Return 404 to caller
  } else if (err instanceof AccessDeniedError) {
    console.log(`Permission denied: ${err.key}`)
    // Return 403 to caller
  } else if (err instanceof StorageError) {
    // Catch all other storage errors
    console.error('Storage error:', err.message, err.cause)
  } else {
    throw err // Re-throw non-storage errors
  }
}
```

## Optimistic concurrency

Use `ifNoneMatch: '*'` to prevent overwriting an existing object:

```typescript
import { ObjectAlreadyExistsError } from '@blobpipe/core'

try {
  await storage.put('config.json', data, {
    contentType: 'application/json',
    ifNoneMatch: '*',
  })
} catch (err) {
  if (err instanceof ObjectAlreadyExistsError) {
    console.log('Object already exists, skipping upload')
  } else {
    throw err
  }
}
```

## Express handler

```typescript
import express from 'express'
import { ObjectNotFoundError, AccessDeniedError, StorageError, MiddlewareRejectionError } from '@blobpipe/core'

const app = express()

app.get('/files/:key', async (req, res) => {
  try {
    const stream = await storage.get(req.params.key)
    stream.pipe(res)
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: 'File not found' })
    } else if (err instanceof AccessDeniedError) {
      res.status(403).json({ error: 'Access denied' })
    } else if (err instanceof StorageError) {
      res.status(502).json({ error: 'Storage error', detail: err.message })
    } else {
      res.status(500).json({ error: 'Internal server error' })
    }
  }
})

app.post('/upload', async (req, res) => {
  try {
    const result = await storage.put(req.body.key, req.body.data, {
      contentType: req.body.contentType,
    })
    res.json({ key: result.key, size: result.size })
  } catch (err) {
    if (err instanceof MiddlewareRejectionError) {
      // Validation failure from middleware (wrong MIME type, file too large, etc.)
      res.status(422).json({ error: err.message, code: err.code })
    } else if (err instanceof StorageError) {
      res.status(502).json({ error: 'Storage error' })
    } else {
      res.status(500).json({ error: 'Internal server error' })
    }
  }
})
```

## Fastify handler

```typescript
import Fastify from 'fastify'
import { ObjectNotFoundError, AccessDeniedError, StorageError, MiddlewareRejectionError } from '@blobpipe/core'

const app = Fastify()

app.setErrorHandler((err, request, reply) => {
  if (err instanceof MiddlewareRejectionError) {
    return reply.status(422).send({ error: err.message, code: err.code })
  }
  if (err instanceof ObjectNotFoundError) {
    return reply.status(404).send({ error: 'File not found' })
  }
  if (err instanceof AccessDeniedError) {
    return reply.status(403).send({ error: 'Access denied' })
  }
  if (err instanceof StorageError) {
    return reply.status(502).send({ error: 'Storage unavailable' })
  }
  return reply.status(500).send({ error: 'Internal server error' })
})
```

## MiddlewareRejectionError

Thrown by middleware (not by drivers) when an upload is rejected — for example, a disallowed MIME type or a file that's too large. It has a `code` property for programmatic handling:

```typescript
import { MiddlewareRejectionError } from '@blobpipe/core'

try {
  await storage.put('file.exe', data, { contentType: 'application/octet-stream' })
} catch (err) {
  if (err instanceof MiddlewareRejectionError) {
    console.log(err.code)    // e.g. 'DISALLOWED_CONTENT_TYPE' | 'FILE_TOO_LARGE' | 'MISSING_CONTENT_TYPE'
    console.log(err.message) // human-readable explanation
  }
}
```

Built-in middleware codes:

| Middleware | Code |
|---|---|
| `validateMimeType` | `DISALLOWED_CONTENT_TYPE`, `MISSING_CONTENT_TYPE` |
| `maxFileSize` | `FILE_TOO_LARGE` |
