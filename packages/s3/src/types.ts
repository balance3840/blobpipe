/**
 * Configuration for S3Driver.
 *
 * Deliberately mirrors the subset of `@aws-sdk/client-s3` S3ClientConfig
 * fields that are actually relevant here, rather than re-exporting the SDK's
 * own config type wholesale — that would leak AWS SDK types into the public
 * API of this library and couple every consumer's type-checking to AWS SDK
 * version changes even if they only ever pass a region and bucket.
 *
 * `endpoint` is included explicitly to support S3-compatible providers
 * (Cloudflare R2, MinIO, DigitalOcean Spaces, Backblaze B2) — a deliberate
 * value-add over libraries that hardcode AWS-only assumptions.
 */
export interface S3DriverConfig {
  /** The S3 bucket to read/write objects from. */
  bucket: string;
  /** AWS region, e.g. "eu-west-1". Required even for S3-compatible providers (often a placeholder value). */
  region: string;
  /** Explicit credentials. If omitted, the underlying AWS SDK falls back to its default credential chain. */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /** Custom endpoint URL, for S3-compatible providers (R2, MinIO, Spaces, B2, etc.). */
  endpoint?: string;
  /** Force path-style addressing instead of virtual-hosted-style. Often required for non-AWS S3-compatible endpoints. */
  forcePathStyle?: boolean;
  /** Optional key prefix automatically applied to every key passed into the driver, for namespacing within a shared bucket. */
  keyPrefix?: string;
  /** Server-side encryption algorithm. Default: none (S3 uses SSE-S3 if bucket policy requires). */
  sse?: 'AES256' | 'aws:kms';
  /** KMS key ID for SSE-KMS encryption. Required when `sse` is 'aws:kms'. */
  sseKmsKeyId?: string;
  /**
   * Controls when request checksums are calculated by the AWS SDK.
   * Set to 'WHEN_REQUIRED' for S3-compatible providers (LocalStack, MinIO, R2)
   * that do not fully implement the AWS checksum specification.
   * Defaults to 'WHEN_SUPPORTED' (SDK default, always calculates).
   */
  requestChecksumCalculation?: 'WHEN_REQUIRED' | 'WHEN_SUPPORTED';
  /**
   * Controls when response checksums are validated by the AWS SDK.
   * Set to 'WHEN_REQUIRED' for S3-compatible providers (LocalStack, MinIO, R2)
   * that return incorrect checksums for range requests.
   * Defaults to 'WHEN_SUPPORTED' (SDK default, always validates).
   */
  responseChecksumValidation?: 'WHEN_REQUIRED' | 'WHEN_SUPPORTED';
}
