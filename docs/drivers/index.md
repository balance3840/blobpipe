# Drivers

Each driver ships as its own package. Install only what you use.

| Package | Provider |
|---|---|
| `@blobpipe/s3` | AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, Backblaze B2 |
| `@blobpipe/gcs` | Google Cloud Storage |
| `@blobpipe/azure-blob` | Azure Blob Storage |
| `@blobpipe/local` | Local filesystem |
| `@blobpipe/memory` | In-memory (tests only) |

## Feature matrix

| Feature | S3 | GCS | Azure Blob | Local | Memory |
|---|:---:|:---:|:---:|:---:|:---:|
| `put` / `get` / `delete` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `exists` / `stat` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `copy` / `move` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `list` / `listPage` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `deleteMany` (bulk) | ✓ | fan-out | fan-out | fan-out | fan-out |
| Object metadata | ✓ | ✓ | ✓ | ✓ | ✓ |
| `getUrl` (public URL) | ✓ | ✓ | ✓ | best-effort | fake |
| `getSignedUrl` (read/write) | ✓ | ✓ | ✓ | best-effort | fake |
| Signed URL content-type enforcement | ✓ | ✓ | — | — | — |
| `ifNoneMatch: '*'` (optimistic write) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Byte-range reads (`start` / `end`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| AbortSignal cancellation | ✓ | ✓ | ✓ | ✓ | ✓ |
| Key prefix (namespacing) | ✓ | ✓ | ✓ | — | — |
| SSE / encryption config | ✓ | ✓ (CMEK) | ✓ | — | — |
| Local emulator support | MinIO / R2 | fake-gcs-server | Azurite | — | — |
| Needs peer deps | AWS SDK | GCS SDK | Azure SDK | — | — |

**Notes:**
- "fan-out" means the driver fans out to individual `delete()` calls with a concurrency limit of 10, rather than using a native bulk-delete API.
- Local `getSignedUrl` and `getUrl` return URLs based on `publicBaseUrl` — no actual signing occurs.
- Memory `getSignedUrl` returns a deterministic `memory://` pseudo-URL for test assertions.

## When to use which driver

**S3** — Default choice for AWS workloads. Also covers R2, MinIO, Spaces, and any S3-compatible API via the `endpoint` option.

**GCS** — Google Cloud Storage. Use ADC (Application Default Credentials) for production workloads on GCP; use `key-file` or `credentials` if you need signed URLs from outside GCP.

**Azure Blob** — Azure Blob Storage. Supports managed identity (`token-credential`), account key (`shared-key`), and connection strings. Use Azurite for local dev.

**Local** — Local filesystem. Good for local development, self-hosted deployments, and serverless functions with a writable `/tmp`.

**Memory** — Zero-dependency, no I/O. Replace any real driver in unit tests without mocking. Use `_dump()` to assert what was stored.
