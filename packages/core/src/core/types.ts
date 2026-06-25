import type { Readable } from 'node:stream';

/**
 * Raw input accepted by `put()`. Drivers are responsible for normalizing
 * whichever of these they receive into whatever their underlying SDK expects.
 */
export type UploadBody = Buffer | Uint8Array | Readable | string;

/**
 * Arbitrary user-supplied key/value pairs attached to an object.
 * Provider-specific size/charset limits on metadata are NOT enforced here —
 * that validation belongs in a driver implementation or a middleware.
 */
export type ObjectMetadata = Record<string, string>;

/**
 * Visibility/access level for an object, normalized across providers.
 * Drivers translate this into their own ACL/permission model
 * (e.g. S3 canned ACLs, Azure Blob public access settings).
 */
export type AccessLevel = 'private' | 'public-read';

export interface PutOptions {
  /** MIME type of the content being stored. If omitted, drivers should attempt sniffing. */
  contentType?: string;
  /** Arbitrary metadata to store alongside the object. */
  metadata?: ObjectMetadata;
  /** Access level for the stored object. Defaults to 'private' if unspecified. */
  access?: AccessLevel;
  /** Abort signal to cancel the operation mid-flight. */
  signal?: AbortSignal;
  /**
   * Provider-specific storage class / tier.
   * S3: 'STANDARD' | 'STANDARD_IA' | 'ONEZONE_IA' | 'INTELLIGENT_TIERING' | 'GLACIER' | 'DEEP_ARCHIVE' | 'GLACIER_IR'
   * GCS: 'STANDARD' | 'NEARLINE' | 'COLDLINE' | 'ARCHIVE'
   * Azure: 'Hot' | 'Cool' | 'Archive'
   * Local/Memory: ignored silently.
   */
  storageClass?: string;
  /**
   * If set to '*', throw `ObjectAlreadyExistsError` if the key already exists.
   * Implemented natively on S3 (IfNoneMatch support), GCS (preconditionOpts.ifGenerationMatch: 0),
   * Azure (conditions.ifNoneMatch: '*'). On Local, uses exclusive-create flag. On Memory, is atomic.
   */
  ifNoneMatch?: '*';
  /** Called periodically during upload with bytes transferred so far and optional total. */
  onProgress?: (transferred: number, total?: number) => void;
}

export interface PutResult {
  /** The key the object was ultimately stored under. */
  key: string;
  /** Size of the stored object in bytes, if known. */
  size?: number;
  /** Entity tag / checksum reported by the provider, if any. */
  etag?: string;
  /** Timestamp of when the provider considers the object written. */
  uploadedAt: Date;
  /** Base64-encoded SHA-256 of the stored content, when available. */
  checksum?: string;
}

export interface StorageObject {
  key: string;
  size: number;
  lastModified: Date;
  etag?: string;
  metadata?: ObjectMetadata;
}

export interface GetOptions {
  signal?: AbortSignal;
  /** Start byte offset (inclusive). */
  start?: number;
  /** End byte offset (inclusive). */
  end?: number;
}
export interface DeleteOptions {
  signal?: AbortSignal;
}
export interface ExistsOptions {
  signal?: AbortSignal;
}
export interface StatOptions {
  signal?: AbortSignal;
}

export interface ListOptions {
  /** Only return objects whose key starts with this prefix. */
  prefix?: string;
  /** Maximum number of objects to return per page. Drivers may cap this. */
  limit?: number;
  /** Opaque pagination cursor returned by a previous listPage call. */
  cursor?: string;
  signal?: AbortSignal;
}

export interface ListPage {
  items: StorageObject[];
  /** Present when more results exist. Pass as `cursor` in the next listPage call. */
  nextCursor?: string;
}

export interface CopyOptions {
  /** Access level to apply to the destination object. If omitted the provider default applies. */
  access?: AccessLevel;
  /** Metadata to apply to the destination object. If omitted the source metadata is preserved. */
  metadata?: ObjectMetadata;
  signal?: AbortSignal;
}

export interface MoveOptions {
  /** Access level to apply to the destination object. */
  access?: AccessLevel;
  /** Metadata to apply to the destination object. If omitted the source metadata is preserved. */
  metadata?: ObjectMetadata;
  signal?: AbortSignal;
}

export interface DeleteManyOptions {
  signal?: AbortSignal;
  /** If true, suppress errors for individual keys that don't exist. Defaults to true. */
  ignoreNotFound?: boolean;
}

export interface DeleteManyResult {
  deleted: string[];
  failed: Array<{ key: string; error: unknown }>;
}

export type SignedUrlOperation = 'read' | 'write' | 'delete';

export interface SignedUrlOptions {
  /** How long the URL should remain valid, in seconds. */
  expiresInSeconds?: number;
  /** Whether the URL grants read, write, or delete access. Defaults to 'read'. */
  operation?: SignedUrlOperation;
  /**
   * For write URLs only: constrain the upload to this MIME type.
   *
   * - S3: bakes `ContentType` into the presigned URL; AWS rejects uploads with a
   *   mismatched Content-Type header (HTTP 403).
   * - GCS: sets `contentType` on the signed URL; GCS enforces the match server-side.
   * - Azure: SAS tokens do not support per-upload Content-Type enforcement;
   *   this field is silently ignored on Azure Blob Storage.
   * - Local/Memory: ignored (no real URL signing).
   */
  contentType?: string;
}
