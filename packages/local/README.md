# @blobpipe/local

Local filesystem storage driver for blobpipe — maps object keys to files under a configured root directory.

## Installation

```bash
npm install @blobpipe/local
```

## Usage

```typescript
import { StorageClient } from '@blobpipe/core';
import { LocalDriver } from '@blobpipe/local';

const client = new StorageClient(
  new LocalDriver({
    rootDir: './storage',
    publicBaseUrl: 'http://localhost:3000/files',
  })
);

await client.put('uploads/hello.txt', 'Hello, world!');
const stream = await client.get('uploads/hello.txt');
const url = client.getUrl('uploads/hello.txt');
// → http://localhost:3000/files/uploads/hello.txt

await client.move('uploads/hello.txt', 'archive/hello.txt'); // atomic rename
```

## Config

```typescript
interface LocalDriverConfig {
  /** Root directory for stored files. Created on first put if absent. */
  rootDir: string;
  /** Base URL for getUrl() and getSignedUrl() — dev only, no real signing. */
  publicBaseUrl?: string;
}
```

## Notes

- Path traversal attempts (keys containing `..`) are rejected with `InvalidKeyError`
- Nested directories are created automatically on `put`
- `move()` uses `fs.rename` — atomic on the same filesystem

## Requirements

Node.js >= 18.17
