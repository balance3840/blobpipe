# Local Driver

```bash
npm install @blobpipe/core @blobpipe/local
```

Stores objects as files on the local filesystem. No external dependencies, no network calls.

## Basic setup

```typescript
import { StorageClient } from '@blobpipe/core'
import { LocalDriver } from '@blobpipe/local'

const storage = new StorageClient(new LocalDriver({
  rootDir: '/var/data/uploads',
}))
```

The `rootDir` is created automatically if it doesn't exist.

## Configuration

```typescript
interface LocalDriverConfig {
  rootDir: string
  publicBaseUrl?: string
}
```

| Option | Type | Description |
|---|---|---|
| `rootDir` | `string` | Absolute path to the storage root directory |
| `publicBaseUrl` | `string` | Base URL for constructing `getUrl()` and `getSignedUrl()` responses (e.g. `"http://localhost:3000/files"`) |

## Path traversal protection

The driver rejects any key that would resolve outside `rootDir`. For example, a key like `../../etc/passwd` throws `InvalidKeyError`. You don't need to sanitize keys yourself.

## Public URLs

If you serve the `rootDir` via a static file server, set `publicBaseUrl` to get useful URLs back from `getUrl()`:

```typescript
const storage = new StorageClient(new LocalDriver({
  rootDir: '/var/data/uploads',
  publicBaseUrl: 'http://localhost:3000/files',
}))

storage.getUrl('avatars/user-123.jpg')
// => 'http://localhost:3000/files/avatars/user-123.jpg'
```

## Signed URL emulation

`getSignedUrl()` returns a URL based on `publicBaseUrl` with a `?expires=<timestamp>` query parameter appended. There is no cryptographic signing — this is a dev-time approximation. Use a real driver for production signed URL workflows.

## When to use

- **Local development** — fast iteration without a cloud account
- **Self-hosted deployments** — a simple file server with persistent storage
- **Serverless functions** — read/write scratch data in `/tmp` (note: ephemeral, not shared across instances)
- **CI pipelines** — write artifacts to disk during a build

## Swapping to a cloud driver

The application code that uses `StorageClient` doesn't change. Only the driver construction changes:

```typescript
// Development
const driver = new LocalDriver({ rootDir: '/tmp/uploads' })

// Production
const driver = new S3Driver({ bucket: 'prod-bucket', region: 'us-east-1' })

const storage = new StorageClient(driver) // same everywhere
```
