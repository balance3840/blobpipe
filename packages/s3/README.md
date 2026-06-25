# @restrella/blobpipe-s3

Amazon S3 (and S3-compatible) storage driver for blobpipe. Works with AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, and any S3-compatible endpoint.

## Installation

```bash
npm install @restrella/blobpipe-s3 @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/lib-storage
```

## Usage

```typescript
import { StorageClient } from '@restrella/blobpipe';
import { S3Driver } from '@restrella/blobpipe-s3';

const client = new StorageClient(
  new S3Driver({
    bucket: 'my-bucket',
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  })
);

await client.put('uploads/file.txt', 'Hello, world!');
const stream = await client.get('uploads/file.txt');
const signedUrl = await client.getSignedUrl('uploads/file.txt', { expiresInSeconds: 3600 });
await client.move('uploads/file.txt', 'archive/file.txt'); // copy + delete
```

### S3-compatible endpoints (R2, MinIO, etc.)

```typescript
new S3Driver({
  bucket: 'my-bucket',
  region: 'auto',
  endpoint: 'https://<account>.r2.cloudflarestorage.com',
  forcePathStyle: false,
  credentials: { accessKeyId: '...', secretAccessKey: '...' },
})
```

## Requirements

Node.js >= 18.17
