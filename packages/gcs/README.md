# @restrella/blobpipe-gcs

Google Cloud Storage driver for blobpipe.

## Installation

```bash
npm install @restrella/blobpipe-gcs @google-cloud/storage
```

## Usage

```typescript
import { StorageClient } from '@restrella/blobpipe';
import { GcsDriver } from '@restrella/blobpipe-gcs';

// Application Default Credentials (ADC)
const client = new StorageClient(
  new GcsDriver({
    bucket: 'my-bucket',
    auth: { mode: 'adc', projectId: 'my-project' },
  })
);

// Service account credentials
const client2 = new StorageClient(
  new GcsDriver({
    bucket: 'my-bucket',
    auth: {
      mode: 'credentials',
      projectId: 'my-project',
      clientEmail: process.env.GCS_CLIENT_EMAIL!,
      privateKey: process.env.GCS_PRIVATE_KEY!,
    },
  })
);

await client.put('uploads/file.txt', 'Hello, world!');
const stream = await client.get('uploads/file.txt');
await client.move('uploads/file.txt', 'archive/file.txt'); // atomic GCS file.move()

const signedUrl = await client.getSignedUrl('uploads/file.txt', { expiresInSeconds: 3600 });
// Note: signed URLs require service account auth (adc with personal accounts won't work)
```

## Requirements

Node.js >= 18.17
