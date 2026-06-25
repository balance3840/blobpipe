import type { Readable } from 'node:stream';
import type {
  CopyOptions,
  DeleteManyOptions,
  DeleteManyResult,
  DeleteOptions,
  ExistsOptions,
  GetOptions,
  ListOptions,
  ListPage,
  MoveOptions,
  PutOptions,
  PutResult,
  SignedUrlOptions,
  StatOptions,
  StorageObject,
  UploadBody,
} from './types.js';

/**
 * The contract every storage driver implements (Strategy pattern).
 *
 * Design notes:
 * - This interface intentionally stays small and provider-agnostic.
 *   Anything provider-specific (e.g. S3 storage classes, Azure access tiers)
 *   belongs in that driver's own config type, not here.
 * - `list` returns an async iterable rather than a single array so drivers
 *   can paginate internally without forcing callers to manage cursors
 *   for the common case of "iterate everything under a prefix".
 * - Methods are deliberately Promise-based (not callback-based) and accept
 *   an optional AbortSignal via PutOptions where cancellation makes sense.
 */
export interface StorageDriver {
  /** A short, stable identifier for this driver, e.g. "s3", "azure-blob", "local", "memory". */
  readonly name: string;

  /** Store `data` under `key`, creating or overwriting it. */
  put(key: string, data: UploadBody, opts?: PutOptions): Promise<PutResult>;

  /** Retrieve the contents of the object stored under `key` as a readable stream. */
  get(key: string, opts?: GetOptions): Promise<Readable>;

  /** Delete the object stored under `key`. Should not throw if the key does not exist. */
  delete(key: string, opts?: DeleteOptions): Promise<void>;

  /** Check whether an object exists under `key`. */
  exists(key: string, opts?: ExistsOptions): Promise<boolean>;

  /** Retrieve metadata about an object without downloading its contents. */
  stat(key: string, opts?: StatOptions): Promise<StorageObject>;

  /** Return the permanent public URL for `key` (no signing, no expiry). Only valid for publicly accessible objects. */
  getUrl(key: string): string;

  /** Generate a time-limited URL granting read or write access to `key`. */
  getSignedUrl(key: string, opts?: SignedUrlOptions): Promise<string>;

  /** Copy the object at `sourceKey` to `destKey` within the same bucket/container. */
  copy(sourceKey: string, destKey: string, opts?: CopyOptions): Promise<void>;

  /**
   * Move (rename) `sourceKey` to `destKey`. Atomic where the provider supports
   * it (local filesystem rename, GCS file.move()); otherwise copy + delete.
   */
  move(sourceKey: string, destKey: string, opts?: MoveOptions): Promise<void>;

  /** Fetch a single page of objects, returning items and an optional cursor for the next page. */
  listPage(opts?: ListOptions): Promise<ListPage>;

  /** Iterate over all objects, optionally filtered by prefix. Handles pagination internally. */
  list(opts?: ListOptions): AsyncIterable<StorageObject>;

  /**
   * Delete multiple objects in a single call where the provider supports it,
   * otherwise fan out with concurrency limit of 10.
   */
  deleteMany(keys: string[], opts?: DeleteManyOptions): Promise<DeleteManyResult>;
}

/**
 * Marker interface for drivers that can be cleanly shut down
 * (e.g. closing SDK clients, flushing connections).
 * Drivers that don't need teardown simply don't implement this.
 */
export interface Disposable {
  dispose(): Promise<void>;
}
