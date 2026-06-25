# Azure Blob Storage Driver

```bash
npm install @blobpipe/core @blobpipe/azure-blob
```

## Basic setup

```typescript
import { StorageClient } from '@blobpipe/core'
import { AzureBlobDriver } from '@blobpipe/azure-blob'

const storage = new StorageClient(new AzureBlobDriver({
  containerName: 'my-container',
  auth: {
    mode: 'connection-string',
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING!,
  },
}))
```

## Configuration

```typescript
interface AzureBlobDriverConfig {
  containerName: string
  keyPrefix?: string
  auth: AzureBlobAuth
  uploadBufferSize?: number
  uploadConcurrency?: number
}
```

| Option | Type | Default | Description |
|---|---|---|---|
| `containerName` | `string` | required | Azure Blob container name |
| `keyPrefix` | `string` | — | Prefix prepended to every key |
| `auth` | `AzureBlobAuth` | required | Authentication config — see [Auth modes](#auth-modes) |
| `uploadBufferSize` | `number` | `4 * 1024 * 1024` | Block size in bytes for streaming uploads (4 MB) |
| `uploadConcurrency` | `number` | `5` | Concurrent block uploads during streaming |

## Auth modes

### Connection string

Quickest option for dev — grab it from the Azure Portal under Storage Account > Access keys:

```typescript
new AzureBlobDriver({
  containerName: 'my-container',
  auth: {
    mode: 'connection-string',
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING!,
  },
})
```

### Shared key

Account name + account key:

```typescript
new AzureBlobDriver({
  containerName: 'my-container',
  auth: {
    mode: 'shared-key',
    accountName: 'mystorageaccount',
    accountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY!,
    endpoint: 'https://mystorageaccount.blob.core.windows.net', // optional override
  },
})
```

### Token credential (managed identity / AAD)

Recommended for production. Pass any `TokenCredential` from `@azure/identity`:

```typescript
import { DefaultAzureCredential } from '@azure/identity'

new AzureBlobDriver({
  containerName: 'my-container',
  auth: {
    mode: 'token-credential',
    accountName: 'mystorageaccount',
    credential: new DefaultAzureCredential(),
  },
})
```

`DefaultAzureCredential` tries the following in order: environment variables, workload identity, managed identity, Azure CLI, and Azure PowerShell.

### RBAC roles required

For managed identity / AAD auth, assign one of these roles on the storage account:

| Role | Access |
|---|---|
| `Storage Blob Data Contributor` | Read + write + delete |
| `Storage Blob Data Reader` | Read only |
| `Storage Blob Data Owner` | Full control including ACL management |

## Signed URLs (SAS)

```typescript
// Read SAS URL
const readUrl = await storage.getSignedUrl('uploads/photo.jpg', {
  expiresInSeconds: 3600,
  operation: 'read',
})

// Write SAS URL
const writeUrl = await storage.getSignedUrl('uploads/new-photo.jpg', {
  expiresInSeconds: 300,
  operation: 'write',
})
```

::: info Content-Type enforcement on Azure
Azure SAS tokens do not support per-upload Content-Type enforcement. The `contentType` option in `SignedUrlOptions` is silently ignored for Azure Blob Storage.
:::

## Local development with Azurite

```bash
# Using Docker
docker run -p 10000:10000 mcr.microsoft.com/azure-storage/azurite azurite-blob --loose
```

```typescript
new AzureBlobDriver({
  containerName: 'my-container',
  auth: {
    mode: 'connection-string',
    connectionString: 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;',
  },
})
```

## Upload tuning for large files

Increase `uploadBufferSize` and `uploadConcurrency` for better throughput with large files on fast connections:

```typescript
new AzureBlobDriver({
  containerName: 'my-container',
  auth: { mode: 'connection-string', connectionString: '...' },
  uploadBufferSize: 16 * 1024 * 1024, // 16 MB blocks
  uploadConcurrency: 8,
})
```

## Storage access tiers

```typescript
await storage.put('archive/old-data.zip', data, {
  contentType: 'application/zip',
  storageClass: 'Archive',
})
```

Azure values: `'Hot'`, `'Cool'`, `'Archive'`
