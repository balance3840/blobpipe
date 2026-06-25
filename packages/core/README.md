# @blobpipe/core

Core abstractions for blobpipe — the `StorageDriver` interface, `StorageClient` wrapper, middleware pipeline, built-in middleware, errors, and utilities.

## Installation

```bash
npm install @blobpipe/core
```

## Usage

```typescript
import { StorageClient, maxFileSize, validateMimeType } from '@blobpipe/core';
import { MemoryDriver } from '@blobpipe/memory';

const client = new StorageClient(new MemoryDriver())
  .use(maxFileSize({ maxBytes: 5 * 1024 * 1024 }))
  .use(validateMimeType({ allowed: ['image/png', 'image/jpeg'] }));

const result = await client.put('uploads/photo.png', buffer, { contentType: 'image/png' });
console.log(result.key, result.size, result.checksum);

const stream = await client.get('uploads/photo.png');
const exists = await client.exists('uploads/photo.png');
const info = await client.stat('uploads/photo.png');

await client.copy('uploads/photo.png', 'backups/photo.png');
await client.move('uploads/photo.png', 'archive/photo.png');
await client.delete('uploads/photo.png');

for await (const obj of client.list({ prefix: 'uploads/' })) {
  console.log(obj.key, obj.size);
}
```

## Key exports

- `StorageClient<D>` — main entry point; wraps any driver with middleware
- `StorageDriverDecorator` — base class for decorator pattern (retries, metrics)
- `RetryingDriver` — adds exponential-backoff retry to any driver
- `InstrumentedDriver` — emits timing/error events for every operation
- `fromUrl(url, opts?)` — fetch a remote URL as a `Readable` with optional timeout/size limit
- Middleware: `maxFileSize`, `validateMimeType`, `logUploads`, `sniffMimeType`
- Errors: `ObjectNotFoundError`, `AccessDeniedError`, `InvalidKeyError`, `StorageOperationError`

## Requirements

Node.js >= 18.17
