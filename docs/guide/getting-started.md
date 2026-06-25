# Getting Started

## Prerequisites

- Node.js **18.17** or later
- TypeScript **5.0** or later (recommended)

## Install

Install the core package and the driver for your storage provider:

::: code-group

```bash [S3 / R2 / MinIO]
npm install @blobpipe/core @blobpipe/s3
```

```bash [Google Cloud Storage]
npm install @blobpipe/core @blobpipe/gcs
```

```bash [Azure Blob Storage]
npm install @blobpipe/core @blobpipe/azure-blob
```

```bash [Local disk]
npm install @blobpipe/core @blobpipe/local
```

```bash [In-memory (tests)]
npm install @blobpipe/core @blobpipe/memory
```

:::

## First example

This example runs with no cloud account — just your local filesystem:

```typescript
import { StorageClient } from '@blobpipe/core'
import { LocalDriver } from '@blobpipe/local'

const driver = new LocalDriver({ rootDir: '/tmp/my-uploads' })
const storage = new StorageClient(driver)

// Upload
const result = await storage.put('hello.txt', 'Hello, blobpipe!', {
  contentType: 'text/plain',
})
console.log(result.key, result.size) // hello.txt  16

// Download
const stream = await storage.get('hello.txt')

// Check existence
const exists = await storage.exists('hello.txt') // true

// Metadata
const obj = await storage.stat('hello.txt')
console.log(obj.size, obj.lastModified)

// Delete
await storage.delete('hello.txt')
```

## Swap to S3 in 3 lines

The application code above is unchanged — only the driver construction changes:

```typescript
import { StorageClient } from '@blobpipe/core'
import { S3Driver } from '@blobpipe/s3'

const driver = new S3Driver({
  bucket: 'my-bucket',
  region: 'us-east-1',
})
const storage = new StorageClient(driver)

// Same API as above
await storage.put('hello.txt', 'Hello, blobpipe!', { contentType: 'text/plain' })
```

Credentials are picked up from the standard AWS credential chain (environment variables, `~/.aws/credentials`, EC2/ECS role, etc.).

## Add middleware

Middleware runs on every `put()`. Stack it with `.use()`:

```typescript
import { StorageClient, validateMimeType, maxFileSize, logUploads } from '@blobpipe/core'
import { S3Driver } from '@blobpipe/s3'

const storage = new StorageClient(new S3Driver({ bucket: 'my-bucket', region: 'us-east-1' }))
  .use(validateMimeType({ allowed: ['image/png', 'image/jpeg', 'image/webp'] }))
  .use(maxFileSize({ maxBytes: 10 * 1024 * 1024 })) // 10 MB
  .use(logUploads())
```

`.use()` is immutable — it returns a new client, so you can safely share a base client and derive variants:

```typescript
const base = new StorageClient(driver).use(logUploads())
const imageOnly = base.use(validateMimeType({ allowed: ['image/png', 'image/jpeg'] }))
const videoOnly = base.use(validateMimeType({ allowed: ['video/mp4'] }))
// base still only has logUploads
```

## What to read next

- [Concepts](/guide/concepts) — understand the Strategy + Chain of Responsibility architecture
- [Drivers overview](/drivers/) — feature matrix and when to use each driver
- [Error handling](/guide/error-handling) — catch provider errors without importing provider SDKs
- [Middleware](/middleware/) — write custom validation and transformation logic
