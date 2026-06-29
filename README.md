# blobpipe

[![npm version](https://img.shields.io/npm/v/blobpipe.svg)](https://www.npmjs.com/package/blobpipe)
[![CI](https://github.com/balance3840/blobpipe/actions/workflows/ci.yml/badge.svg)](https://github.com/balance3840/blobpipe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**One API for S3, Google Cloud Storage, Azure Blob, local disk, and in-memory storage.**

Switch providers by swapping a single constructor call. Your upload logic, validation middleware, and error handling stay exactly the same.

```typescript
import { StorageClient } from 'blobpipe';
import { S3Driver }      from 'blobpipe/s3';
import { LocalDriver }   from 'blobpipe/local';

// Same client, same API — swap the driver for any environment
const driver = process.env.NODE_ENV === 'production'
  ? new S3Driver({ bucket: 'my-bucket', region: 'us-east-1' })
  : new LocalDriver({ rootDir: './storage' });

const client = new StorageClient(driver)
  .use(validateMimeType({ allowed: ['image/png', 'image/jpeg'] }))
  .use(maxFileSize({ maxBytes: 10 * 1024 * 1024 }))
  .use(logUploads());

await client.put('avatars/user-123.jpg', fileStream, { contentType: 'image/jpeg' });
```

---

## Features

- **Five drivers** — S3 (+ R2, MinIO, Spaces), Google Cloud Storage, Azure Blob Storage, local disk, in-memory
- **Middleware pipeline** — validate, transform, and log uploads with composable middleware; `use()` is immutable
- **Normalized errors** — catch `ObjectNotFoundError`, `AccessDeniedError`, etc. without importing any provider SDK
- **Full TypeScript** — every option, result, and error is typed end-to-end
- **AbortSignal** — all operations accept a `signal` for request-scoped cancellation
- **Tree-shakeable** — drivers are separate subpath exports; unused SDKs are never bundled

---

## Installation

```bash
npm install blobpipe
```

Install the SDK for the providers you need (only what you use):

```bash
# Amazon S3 / S3-compatible (R2, MinIO, Spaces)
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# Google Cloud Storage
npm install @google-cloud/storage

# Azure Blob Storage
npm install @azure/storage-blob @azure/identity
```

`LocalDriver` and `MemoryDriver` have no extra dependencies.

---

## Quick start

### Local disk (zero config)

```typescript
import { StorageClient } from 'blobpipe';
import { LocalDriver }   from 'blobpipe/local';

const client = new StorageClient(new LocalDriver({ rootDir: './uploads' }));

await client.put('hello.txt', 'Hello, world!');

const stream = await client.get('hello.txt');
for await (const chunk of stream) process.stdout.write(chunk);
```

### Amazon S3

```typescript
import { S3Driver } from 'blobpipe/s3';

const client = new StorageClient(
  new S3Driver({ bucket: 'my-bucket', region: 'us-east-1' })
);
// Credentials come from the standard AWS credential chain (env vars, ~/.aws, IAM roles)
```

### Google Cloud Storage

```typescript
import { GcsDriver } from 'blobpipe/gcs';

const client = new StorageClient(
  new GcsDriver({ bucket: 'my-bucket', auth: { mode: 'adc', projectId: 'my-project' } })
);
```

### Azure Blob Storage

```typescript
import { AzureBlobDriver }      from 'blobpipe/azure-blob';
import { DefaultAzureCredential } from '@azure/identity';

const client = new StorageClient(
  new AzureBlobDriver({
    containerName: 'uploads',
    auth: { mode: 'token-credential', accountName: 'mystorageaccount', credential: new DefaultAzureCredential() },
  })
);
```

---

## Core API

### `put(key, data, opts?)`

Stores an object. Accepts strings, Buffers, Uint8Arrays, and Node.js Readable streams.

```typescript
await client.put('reports/q4.pdf', fileStream, {
  contentType: 'application/pdf',
  metadata:    { author: 'finance-bot', quarter: 'Q4' },
  access:      'private',          // 'private' | 'public-read'
  storageClass: 'INTELLIGENT_TIERING',
  ifNoneMatch: '*',                // throws ObjectAlreadyExistsError if key exists
  signal:      req.signal,         // AbortSignal
  onProgress:  (n, total) => console.log(`${n}/${total} bytes`),
});
```

Returns `{ key, size?, etag?, uploadedAt, checksum? }`.

### `get(key, opts?)`

Returns a `Readable` stream. Throws `ObjectNotFoundError` if the key does not exist.

```typescript
// Full object
const stream = await client.get('reports/q4.pdf');

// Byte range (both bounds inclusive)
const first1KB = await client.get('reports/q4.pdf', { start: 0, end: 1023 });
```

### `exists(key)` · `stat(key)`

```typescript
await client.exists('reports/q4.pdf'); // → boolean

const info = await client.stat('reports/q4.pdf');
// → { key, size, lastModified, etag?, metadata? }
```

### `delete(key)` · `deleteMany(keys)`

`delete` is a no-op if the key doesn't exist. `deleteMany` returns `{ deleted, failed }` — it never throws.

```typescript
await client.delete('tmp/draft.txt');

const { deleted, failed } = await client.deleteMany([
  'tmp/a.txt', 'tmp/b.txt', 'tmp/c.txt',
]);
```

### `copy(src, dst)` · `move(src, dst)`

```typescript
await client.copy('originals/photo.jpg', 'thumbnails/photo.jpg');
await client.move('tmp/upload-abc123',   'documents/report.pdf');
```

### `list(opts?)` · `listPage(opts?)`

```typescript
// Async iterable — paginates internally
for await (const obj of client.list({ prefix: 'uploads/', limit: 100 })) {
  console.log(obj.key, obj.size);
}

// Manual pagination
const { items, nextCursor } = await client.listPage({ prefix: 'uploads/', limit: 50 });
if (nextCursor) { /* fetch next page */ }
```

### `getSignedUrl(key, opts?)`

Generates a time-limited URL for browser upload or download without exposing credentials.

```typescript
// Download link valid for 5 minutes
const downloadUrl = await client.getSignedUrl('reports/q4.pdf', {
  operation: 'read', expiresInSeconds: 300,
});

// Direct-upload URL (browser uploads without hitting your server)
const uploadUrl = await client.getSignedUrl('uploads/photo.jpg', {
  operation:   'write',
  expiresInSeconds: 600,
  contentType: 'image/jpeg', // S3 and GCS enforce this; Azure ignores it
});
```

### `dispose()` / `await using`

```typescript
await client.dispose(); // closes SDK connections

// TypeScript 5.2+ explicit resource management
await using client = new StorageClient(driver);
```

---

## Fetching from a URL

`fromUrl` fetches a remote file as a stream and extracts its `Content-Type`, so you can pipe remote files straight into storage without buffering them in memory.

```typescript
import { fromUrl } from 'blobpipe';

const { body, contentType } = await fromUrl('https://example.com/report.pdf', {
  timeoutMs: 10_000,
  maxBytes:  50 * 1024 * 1024,
});
await client.put('reports/latest.pdf', body, { contentType });
```

---

## Middleware

`use()` returns a new `StorageClient` — the original is never mutated:

```typescript
const base     = new StorageClient(driver).use(logUploads());
const images   = base.use(validateMimeType({ allowed: ['image/png', 'image/jpeg', 'image/webp'] }));
const docs     = base.use(maxFileSize({ maxBytes: 50 * 1024 * 1024 }));
// base still only has logUploads
```

### Built-in middleware

| Middleware | Purpose |
|---|---|
| `validateMimeType({ allowed })` | Reject uploads with disallowed `contentType` |
| `maxFileSize({ maxBytes })` | Reject uploads exceeding the size limit |
| `logUploads({ logger?, format? })` | Log key, duration, size, and etag on every upload |
| `sniffMimeType({ override? })` | Detect and set `contentType` automatically (requires `file-type`) |

```typescript
import { validateMimeType, maxFileSize, logUploads, sniffMimeType } from 'blobpipe';

// Structured JSON logging (Datadog, CloudWatch, Pino, etc.)
const client = new StorageClient(driver).use(
  logUploads({ format: 'json', logger: pino() }),
);

// Auto-detect MIME type (install: npm install file-type)
const client = new StorageClient(driver).use(sniffMimeType());
```

### Custom middleware

```typescript
import type { Middleware } from 'blobpipe';

const addVersionMetadata: Middleware = async (ctx, next) => {
  ctx.options = {
    ...ctx.options,
    metadata: { ...ctx.options.metadata, appVersion: '2.1.0' },
  };
  await next();
  console.log('Stored as:', ctx.result?.key);
};

const client = new StorageClient(driver).use(addVersionMetadata);
```

---

## Decorators

Decorators wrap any driver and add cross-cutting behavior for every operation (not just uploads):

```typescript
import { RetryingDriver, InstrumentedDriver } from 'blobpipe';

// Exponential backoff with jitter — wraps any driver
const retrying = new RetryingDriver(driver, {
  maxAttempts: 4,
  baseDelayMs: 250,
  shouldRetry: (err) => err instanceof StorageOperationError,
});

// Emit timing events — integrate with your metrics library
const instrumented = new InstrumentedDriver(driver);
instrumented.on('operation', ({ operation, durationMs, error }) => {
  metrics.histogram('storage.duration', durationMs, { op: operation });
});

const client = new StorageClient(new RetryingDriver(new InstrumentedDriver(driver)));
```

---

## Error handling

All errors extend `StorageError` — no provider SDK types leak out:

```typescript
import {
  ObjectNotFoundError,
  AccessDeniedError,
  ObjectAlreadyExistsError,
  StorageOperationError,
  DriverConfigurationError,
  MiddlewareRejectionError,
} from 'blobpipe';

try {
  await client.put('avatar.jpg', stream, { ifNoneMatch: '*' });
} catch (err) {
  if (err instanceof ObjectAlreadyExistsError) {
    return res.status(409).json({ error: 'File already exists' });
  }
  if (err instanceof AccessDeniedError) {
    return res.status(403).json({ error: 'Storage permission denied' });
  }
  if (err instanceof MiddlewareRejectionError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  throw err; // unexpected — let your error boundary handle it
}
```

| Error | When |
|---|---|
| `ObjectNotFoundError` | `get` / `stat` / `copy` / `move` on a missing key |
| `ObjectAlreadyExistsError` | `put` with `ifNoneMatch: '*'` on an existing key |
| `AccessDeniedError` | Insufficient permissions on the provider |
| `StorageOperationError` | Network error, timeout, provider API failure |
| `DriverConfigurationError` | Misconfigured driver (wrong bucket, bad credentials) |
| `InvalidKeyError` | Key contains illegal characters (path traversal, etc.) |
| `MiddlewareRejectionError` | Upload rejected by middleware (wrong MIME, too large) |

---

## Using MemoryDriver in tests

`MemoryDriver` is a drop-in replacement that runs in-process — no Docker, no credentials:

```typescript
import { StorageClient } from 'blobpipe';
import { MemoryDriver }  from 'blobpipe/memory';
import { describe, it, expect, beforeEach } from 'vitest';

describe('UserAvatarService', () => {
  let client: StorageClient;

  beforeEach(() => {
    client = new StorageClient(new MemoryDriver());
  });

  it('stores and serves an avatar', async () => {
    await client.put('avatars/u1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(await client.exists('avatars/u1.png')).toBe(true);
  });
});
```

---

## Driver comparison

| Feature | S3 | GCS | Azure | Local | Memory |
|---|:---:|:---:|:---:|:---:|:---:|
| `put` / `get` / `delete` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Metadata | ✅ | ✅ | ✅ | — | ✅ |
| Signed URLs | ✅ | ✅ | ✅ | fake | fake |
| `ifNoneMatch: '*'` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Byte-range `get` | ✅ | ✅ | ✅ | ✅ | ✅ |
| AbortSignal | ✅ | ✅ | ✅ | ✅ | ✅ |
| Local emulator | Localstack | fake-gcs-server | Azurite | — | — |

---

## S3-compatible endpoints

Works with Cloudflare R2, MinIO, DigitalOcean Spaces, and any S3-compatible service:

```typescript
// Cloudflare R2
new S3Driver({
  bucket:         'my-bucket',
  region:         'auto',
  endpoint:       'https://<account-id>.r2.cloudflarestorage.com',
  forcePathStyle: false,
  credentials:    { accessKeyId: R2_KEY, secretAccessKey: R2_SECRET },
});

// MinIO (local)
new S3Driver({
  bucket:         'my-bucket',
  region:         'us-east-1',
  endpoint:       'http://localhost:9000',
  forcePathStyle: true,
  credentials:    { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
});
```

---

## Local development with emulators

Run all three cloud providers locally with Docker Compose:

```bash
docker compose -f docker-compose.emulators.yml up -d
```

| Service | Port | Connect with |
|---|---|---|
| AWS S3 (Localstack) | `4566` | `endpoint: 'http://localhost:4566', forcePathStyle: true` |
| Azure Blob (Azurite) | `10000` | `connectionString: 'UseDevelopmentStorage=true'` |
| GCS (fake-gcs-server) | `4443` | `apiEndpoint: 'http://localhost:4443'` |

---

## Documentation

Full documentation at **[blobpipe.dev](https://balance3840.github.io/blobpipe)**:

- [Getting started](https://balance3840.github.io/blobpipe/guide/getting-started)
- [Drivers](https://balance3840.github.io/blobpipe/drivers/)
- [Middleware guide](https://balance3840.github.io/blobpipe/middleware/)
- [API reference](https://balance3840.github.io/blobpipe/api/storage-client)

---

## License

MIT
