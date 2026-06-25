# Google Cloud Storage Driver

```bash
npm install @restrella/blobpipe @restrella/blobpipe-gcs
```

## Basic setup

```typescript
import { StorageClient } from '@restrella/blobpipe'
import { GcsDriver } from '@restrella/blobpipe-gcs'

const storage = new StorageClient(new GcsDriver({
  bucket: 'my-bucket',
  auth: { mode: 'adc', projectId: 'my-gcp-project' },
}))
```

## Configuration

```typescript
interface GcsDriverConfig {
  bucket: string
  auth: GcsAuth
  apiEndpoint?: string
  keyPrefix?: string
  kmsKeyName?: string
}
```

| Option | Type | Description |
|---|---|---|
| `bucket` | `string` | GCS bucket name |
| `auth` | `GcsAuth` | Authentication config — see [Auth modes](#auth-modes) |
| `apiEndpoint` | `string` | Custom API endpoint (for the GCS emulator) |
| `keyPrefix` | `string` | Prefix prepended to every key |
| `kmsKeyName` | `string` | Customer-managed encryption key resource name |

## Auth modes

### Application Default Credentials (recommended for GCP)

```typescript
new GcsDriver({
  bucket: 'my-bucket',
  auth: { mode: 'adc', projectId: 'my-gcp-project' },
})
```

The SDK picks up credentials from:
1. `GOOGLE_APPLICATION_CREDENTIALS` environment variable (path to a key file)
2. `gcloud auth application-default login` (local dev)
3. Workload Identity (GKE)
4. Metadata server (Cloud Run, Compute Engine, App Engine)

::: warning Signed URLs with ADC
ADC via a user account (`gcloud auth login`) **cannot** generate signed URLs — user accounts don't carry the private key needed for signing. Use `key-file` or `credentials` mode if you need `getSignedUrl()`.
:::

### Service account key file

```typescript
new GcsDriver({
  bucket: 'my-bucket',
  auth: {
    mode: 'key-file',
    projectId: 'my-gcp-project',
    keyFilename: '/path/to/service-account.json',
  },
})
```

### Inline service account credentials

Useful when credentials come from a secret manager rather than a file on disk:

```typescript
new GcsDriver({
  bucket: 'my-bucket',
  auth: {
    mode: 'credentials',
    projectId: 'my-gcp-project',
    clientEmail: 'my-sa@my-project.iam.gserviceaccount.com',
    privateKey: process.env.GCS_PRIVATE_KEY!, // PEM-encoded RSA private key
  },
})
```

## Signed URLs

Signed URLs require a service account with a private key (`key-file` or `credentials` auth mode):

```typescript
// Read URL
const readUrl = await storage.getSignedUrl('uploads/photo.jpg', {
  expiresInSeconds: 900,
  operation: 'read',
})

// Write URL with content-type enforcement
// GCS enforces the content-type match server-side
const writeUrl = await storage.getSignedUrl('uploads/new-photo.jpg', {
  expiresInSeconds: 300,
  operation: 'write',
  contentType: 'image/jpeg',
})
```

## Local development with fake-gcs-server

```bash
docker run -p 4443:4443 fsouza/fake-gcs-server -scheme http -public-host localhost:4443
```

```typescript
new GcsDriver({
  bucket: 'my-bucket',
  auth: { mode: 'adc', projectId: 'test' },
  apiEndpoint: 'http://localhost:4443',
})
```

## Customer-managed encryption (CMEK)

```typescript
new GcsDriver({
  bucket: 'my-bucket',
  auth: { mode: 'adc', projectId: 'my-project' },
  kmsKeyName: 'projects/my-project/locations/us/keyRings/my-ring/cryptoKeys/my-key',
})
```

## Storage classes

```typescript
await storage.put('archive/old-data.zip', data, {
  contentType: 'application/zip',
  storageClass: 'ARCHIVE',
})
```

GCS values: `'STANDARD'`, `'NEARLINE'`, `'COLDLINE'`, `'ARCHIVE'`
