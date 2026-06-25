# @restrella/blobpipe-azure-blob

Azure Blob Storage driver for blobpipe.

## Installation

```bash
npm install @restrella/blobpipe-azure-blob @azure/storage-blob
# For token-credential auth (recommended for production):
npm install @azure/identity
```

## Usage

```typescript
import { StorageClient } from '@restrella/blobpipe';
import { AzureBlobDriver } from '@restrella/blobpipe-azure-blob';

// Connection string
const client = new StorageClient(
  new AzureBlobDriver({
    containerName: 'my-container',
    auth: {
      mode: 'connection-string',
      connectionString: process.env.AZURE_CONNECTION_STRING!,
    },
  })
);

// Managed identity / DefaultAzureCredential (recommended for production)
import { DefaultAzureCredential } from '@azure/identity';
const client2 = new StorageClient(
  new AzureBlobDriver({
    containerName: 'my-container',
    auth: {
      mode: 'token-credential',
      accountName: 'mystorageaccount',
      credential: new DefaultAzureCredential(),
    },
  })
);

await client.put('uploads/file.txt', 'Hello, world!');
const stream = await client.get('uploads/file.txt');
await client.move('uploads/file.txt', 'archive/file.txt'); // copy + delete

const signedUrl = await client.getSignedUrl('uploads/file.txt', {
  operation: 'read',
  expiresInSeconds: 3600,
});
```

## Requirements

Node.js >= 18.17
