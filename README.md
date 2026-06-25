# blobpipe

[![npm version](https://img.shields.io/npm/v/@restrella/blobpipe.svg)](https://www.npmjs.com/package/@restrella/blobpipe)
[![npm downloads](https://img.shields.io/npm/dm/@restrella/blobpipe.svg)](https://www.npmjs.com/package/@restrella/blobpipe)
[![CI](https://github.com/balance3840/blobpipe/actions/workflows/ci.yml/badge.svg)](https://github.com/balance3840/blobpipe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**One API for S3, Google Cloud Storage, Azure Blob, local disk, and in-memory storage.**

Switch cloud providers by swapping a single line. Your upload logic, validation, and error handling never change.

📖 **[Full documentation](https://balance3840.github.io/blobpipe)** — guides, driver references, API docs, and examples.

---

```typescript
import { StorageClient, logUploads, validateMimeType, maxFileSize } from '@restrella/blobpipe';
import { S3Driver }     from '@restrella/blobpipe-s3';
import { LocalDriver }  from '@restrella/blobpipe-local';

const driver = process.env.NODE_ENV === 'production'
  ? new S3Driver({ bucket: 'my-bucket', region: 'us-east-1' })
  : new LocalDriver({ rootDir: './uploads' });

const storage = new StorageClient(driver)
  .use(validateMimeType({ allowed: ['image/png', 'image/jpeg', 'image/webp'] }))
  .use(maxFileSize({ maxBytes: 10 * 1024 * 1024 }))
  .use(logUploads());

// Works the same regardless of which driver is underneath
await storage.put('avatars/user-123.jpg', fileStream, { contentType: 'image/jpeg' });
const stream = await storage.get('avatars/user-123.jpg');
```

---

## Why blobpipe?

Most apps start on one cloud and end up on another, or need to run against local disk in dev and S3 in prod. Normally that means rewriting your upload code, your error handling, and your tests every time.

blobpipe gives you **one interface** and lets the driver handle the provider specifics. You write your feature once.

- **Five drivers** — S3 (+ R2, MinIO, Spaces), Google Cloud Storage, Azure Blob, local disk, in-memory
- **Middleware pipeline** — validate, transform, and log uploads; chain as many as you need
- **Normalized errors** — `ObjectNotFoundError`, `AccessDeniedError` — no AWS or Azure types in your catch blocks
- **Full TypeScript** — every option, result, and error typed end-to-end
- **AbortSignal everywhere** — cancel any in-flight operation when a request ends
- **Tree-shakeable** — each driver is its own package; unused SDKs are never bundled

---

## Install

```bash
npm install @restrella/blobpipe
```

Add the package for whichever providers you use:

```bash
npm install @restrella/blobpipe-s3       # Amazon S3, R2, MinIO, Spaces
npm install @restrella/blobpipe-gcs      # Google Cloud Storage
npm install @restrella/blobpipe-azure-blob  # Azure Blob Storage
npm install @restrella/blobpipe-local    # local disk (no extra deps)
npm install @restrella/blobpipe-memory   # in-memory for tests (no extra deps)
```

Each driver package requires its own cloud SDK:

```bash
# S3
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# GCS
npm install @google-cloud/storage

# Azure
npm install @azure/storage-blob @azure/identity
```

---

## Quick start

### Local disk — works immediately, no config

```typescript
import { StorageClient } from '@restrella/blobpipe';
import { LocalDriver }   from '@restrella/blobpipe-local';

const storage = new StorageClient(new LocalDriver({ rootDir: './uploads' }));

await storage.put('hello.txt', 'Hello, world!');

const stream = await storage.get('hello.txt');
for await (const chunk of stream) process.stdout.write(chunk);
```

### Amazon S3

```typescript
import { StorageClient } from '@restrella/blobpipe';
import { S3Driver }      from '@restrella/blobpipe-s3';

const storage = new StorageClient(
  new S3Driver({ bucket: 'my-bucket', region: 'us-east-1' })
  // credentials come from env vars, ~/.aws, or IAM roles automatically
);
```

### Google Cloud Storage

```typescript
import { StorageClient } from '@restrella/blobpipe';
import { GcsDriver }     from '@restrella/blobpipe-gcs';

const storage = new StorageClient(
  new GcsDriver({ bucket: 'my-bucket', auth: { mode: 'adc', projectId: 'my-project' } })
);
```

### Azure Blob Storage

```typescript
import { StorageClient }        from '@restrella/blobpipe';
import { AzureBlobDriver }      from '@restrella/blobpipe-azure-blob';
import { DefaultAzureCredential } from '@azure/identity';

const storage = new StorageClient(
  new AzureBlobDriver({
    containerName: 'uploads',
    auth: {
      mode:        'token-credential',
      accountName: 'mystorageaccount',
      credential:  new DefaultAzureCredential(),
    },
  })
);
```

---

## How it works

There are three layers you can compose freely:

```
┌─────────────────────────────────────────────────────┐
│  new StorageClient(driver).use(mw1).use(mw2)        │
│                                                     │
│  ┌────────────────────────────────────────────┐     │
│  │ Middleware (put only)                      │     │
│  │  validateMimeType → maxFileSize → logUploads│     │
│  └────────────────────────────────────────────┘     │
│                       ↓                             │
│  ┌────────────────────────────────────────────┐     │
│  │ Driver (all operations)                    │     │
│  │  RetryingDriver → InstrumentedDriver → S3  │     │
│  └────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────┘
```

**Drivers** know how to talk to a specific provider. You can wrap a driver in another driver to add retry logic or metrics — it's just nesting:

```typescript
import { RetryingDriver, InstrumentedDriver } from '@restrella/blobpipe';

const storage = new StorageClient(
  new RetryingDriver(           // retries transiently failed operations
    new InstrumentedDriver(     // fires timing events for metrics
      new S3Driver(config)      // talks to S3
    ),
    { maxAttempts: 3, baseDelayMs: 200 }
  )
);
```

**Middleware** runs before every `put()`. Each piece is independent and chainable. `use()` returns a new client — the original is never touched — so you can safely derive variants from a shared base:

```typescript
const base   = new StorageClient(driver).use(logUploads());
const images = base.use(validateMimeType({ allowed: ['image/png', 'image/jpeg'] }));
const docs   = base.use(maxFileSize({ maxBytes: 50 * 1024 * 1024 }));
// base still only has logUploads — images and docs are independent
```

---

## API

### `put(key, data, opts?)`

Stores an object. Accepts strings, Buffers, Uint8Arrays, and Readable streams.

```typescript
const result = await storage.put('reports/q4.pdf', fileStream, {
  contentType:  'application/pdf',
  metadata:     { author: 'finance-bot', quarter: 'Q4' },
  access:       'public-read',       // 'private' (default) | 'public-read'
  ifNoneMatch:  '*',                 // throw ObjectAlreadyExistsError if key exists
  signal:       req.signal,          // cancel the upload when the request ends
  onProgress:   (bytes) => console.log(`${bytes} bytes uploaded`),
});
// → { key, size, etag, uploadedAt, checksum }
```

### `get(key, opts?)`

Returns a `Readable` stream. Throws `ObjectNotFoundError` if missing.

```typescript
const stream = await storage.get('reports/q4.pdf');

// Byte range (both bounds inclusive) — great for video seeking or resumable downloads
const chunk = await storage.get('video.mp4', { start: 0, end: 1_048_575 });
```

### `exists(key)` · `stat(key)`

```typescript
const found = await storage.exists('report.pdf');   // → boolean

const info = await storage.stat('report.pdf');
// → { key, size, lastModified, etag?, metadata? }
```

### `delete(key)` · `deleteMany(keys)`

`delete` is always a no-op if the key doesn't exist. `deleteMany` fans out in parallel and returns `{ deleted, failed }` without ever throwing.

```typescript
await storage.delete('tmp/draft.txt');

const { deleted, failed } = await storage.deleteMany([
  'tmp/a.txt', 'tmp/b.txt', 'tmp/c.txt',
]);
```

### `copy(src, dst)` · `move(src, dst)`

```typescript
await storage.copy('originals/photo.jpg', 'thumbnails/photo.jpg');
await storage.move('tmp/upload-abc123',   'documents/report.pdf');
```

### `list(opts?)` · `listPage(opts?)`

```typescript
// Async iterable — handles pagination automatically
for await (const obj of storage.list({ prefix: 'uploads/', limit: 100 })) {
  console.log(obj.key, obj.size, obj.lastModified);
}

// Manual pagination
const page1 = await storage.listPage({ prefix: 'uploads/', limit: 50 });
const page2 = await storage.listPage({ prefix: 'uploads/', limit: 50, cursor: page1.nextCursor });
```

### `getSignedUrl(key, opts?)`

Time-limited URL for browser uploads or downloads — no credentials exposed.

```typescript
// Download link valid for 5 minutes
const url = await storage.getSignedUrl('report.pdf', {
  operation: 'read', expiresInSeconds: 300,
});

// Direct browser upload — the upload goes straight to S3, not through your server
const uploadUrl = await storage.getSignedUrl('uploads/photo.jpg', {
  operation:        'write',
  expiresInSeconds: 600,
  contentType:      'image/jpeg', // S3 and GCS enforce this; Azure ignores it
});
```

### `fromUrl(url, opts?)`

Fetch a remote file and pipe it straight into storage without buffering it in memory.

```typescript
import { fromUrl } from '@restrella/blobpipe';

const { body, contentType } = await fromUrl('https://example.com/report.pdf', {
  timeoutMs: 10_000,
  maxBytes:  50 * 1024 * 1024,
});
await storage.put('mirror/report.pdf', body, { contentType });
```

---

## Middleware

### Built-in

| Middleware | What it does |
|---|---|
| `validateMimeType({ allowed })` | Rejects uploads whose `contentType` isn't in the list |
| `maxFileSize({ maxBytes })` | Rejects uploads over the limit (checks both Buffer size and stream bytes) |
| `logUploads({ logger?, format? })` | Logs key, duration, size, and etag after every upload |
| `sniffMimeType({ override? })` | Reads the first bytes and sets `contentType` automatically — requires `file-type` |

```typescript
import { validateMimeType, maxFileSize, logUploads } from '@restrella/blobpipe';

const storage = new StorageClient(driver)
  .use(validateMimeType({ allowed: ['image/png', 'image/jpeg', 'image/webp'] }))
  .use(maxFileSize({ maxBytes: 5 * 1024 * 1024 }))
  .use(logUploads({ format: 'json' })); // structured JSON for Datadog, CloudWatch, Pino
```

### Writing your own

A middleware is just an async function — add metadata, call a virus scanner, enforce custom rules:

```typescript
import type { Middleware } from '@restrella/blobpipe';

const addVersionMetadata: Middleware = async (ctx, next) => {
  ctx.options = {
    ...ctx.options,
    metadata: { ...ctx.options.metadata, appVersion: process.env.APP_VERSION ?? 'unknown' },
  };
  await next();
  console.log(`Uploaded ${ctx.result?.key} (${ctx.result?.size} bytes)`);
};
```

---

## Error handling

Every error extends `StorageError` — you never catch AWS or Azure SDK types in your application code:

```typescript
import {
  ObjectNotFoundError,
  ObjectAlreadyExistsError,
  AccessDeniedError,
  StorageOperationError,
  MiddlewareRejectionError,
} from '@restrella/blobpipe';

try {
  await storage.put('avatar.jpg', stream, { ifNoneMatch: '*' });
} catch (err) {
  if (err instanceof ObjectAlreadyExistsError) return res.status(409).json({ error: 'Already exists' });
  if (err instanceof AccessDeniedError)        return res.status(403).json({ error: 'Permission denied' });
  if (err instanceof MiddlewareRejectionError) return res.status(422).json({ error: err.message });
  throw err;
}
```

| Error | Thrown when |
|---|---|
| `ObjectNotFoundError` | `get` / `stat` / `copy` / `move` on a key that doesn't exist |
| `ObjectAlreadyExistsError` | `put` with `ifNoneMatch: '*'` and the key already exists |
| `AccessDeniedError` | The provider rejects the operation due to insufficient permissions |
| `StorageOperationError` | Network failure, timeout, or unexpected provider response |
| `DriverConfigurationError` | Bad credentials, wrong bucket/container name |
| `InvalidKeyError` | Key contains path traversal sequences or other illegal characters |
| `MiddlewareRejectionError` | Upload blocked by a middleware rule |

---

## Testing with MemoryDriver

`MemoryDriver` is a zero-dependency, in-process drop-in for any cloud driver. No Docker, no credentials, no network:

```typescript
import { StorageClient } from '@restrella/blobpipe';
import { MemoryDriver }  from '@restrella/blobpipe-memory';
import { beforeEach, it, expect } from 'vitest';

let storage: StorageClient;

beforeEach(() => {
  // Fresh store for each test — no shared state between tests
  storage = new StorageClient(new MemoryDriver());
});

it('rejects oversized uploads', async () => {
  const limited = storage.use(maxFileSize({ maxBytes: 100 }));
  await expect(limited.put('big.txt', 'x'.repeat(101))).rejects.toThrow();
});
```

---

## Driver comparison

| | S3 | GCS | Azure | Local | Memory |
|---|:---:|:---:|:---:|:---:|:---:|
| put / get / delete | ✅ | ✅ | ✅ | ✅ | ✅ |
| Metadata | ✅ | ✅ | ✅ | — | ✅ |
| Signed URLs | ✅ | ✅ | ✅ | fake | fake |
| `ifNoneMatch: '*'` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Byte-range `get` | ✅ | ✅ | ✅ | ✅ | ✅ |
| AbortSignal | ✅ | ✅ | ✅ | ✅ | ✅ |
| Local emulator | Localstack | fake-gcs-server | Azurite | — | — |

---

## S3-compatible services

Works with Cloudflare R2, MinIO, DigitalOcean Spaces — anything that speaks the S3 protocol:

```typescript
// Cloudflare R2
new S3Driver({
  bucket:         'my-bucket',
  region:         'auto',
  endpoint:       'https://<account-id>.r2.cloudflarestorage.com',
  credentials:    { accessKeyId: R2_KEY, secretAccessKey: R2_SECRET },
});

// MinIO (local dev)
new S3Driver({
  bucket:         'my-bucket',
  region:         'us-east-1',
  endpoint:       'http://localhost:9000',
  forcePathStyle: true,
  credentials:    { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
});
```

---

## Local emulators

Run all three cloud providers locally with one command:

```bash
docker compose -f docker-compose.emulators.yml up -d
```

| Provider | Port | Connection |
|---|---|---|
| AWS S3 (Localstack) | `4566` | `endpoint: 'http://localhost:4566', forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' }` |
| Azure Blob (Azurite) | `10000` | `auth: { mode: 'connection-string', connectionString: 'UseDevelopmentStorage=true' }` |
| GCS (fake-gcs-server) | `4443` | `apiEndpoint: 'http://localhost:4443'` |

---

## License

MIT
