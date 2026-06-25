import type { Readable } from 'node:stream';
import type { StorageDriver } from './storage-driver.js';
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
 * Base class for driver decorators (Decorator pattern).
 *
 * Distinction from middleware (see middleware-types.ts):
 * - Middleware operates on *upload content/intent* (validation, transformation)
 *   and only runs around `put()`.
 * - Decorators wrap the *driver itself* and apply to every operation
 *   (get, delete, list, etc.), typically for infrastructure concerns like
 *   retries, logging, metrics, or caching — things that don't care what's
 *   being uploaded, only that an operation against the backend is happening.
 *
 * Concrete decorators (e.g. RetryingDriver, LoggingDriver) extend this and
 * override only the methods they need to augment; everything else passes
 * through to the wrapped driver by default.
 */
export abstract class StorageDriverDecorator implements StorageDriver {
  protected constructor(protected readonly inner: StorageDriver) {}

  abstract readonly name: string;

  put(key: string, data: UploadBody, opts?: PutOptions): Promise<PutResult> {
    return this.inner.put(key, data, opts);
  }

  get(key: string, opts?: GetOptions): Promise<Readable> {
    return this.inner.get(key, opts);
  }

  delete(key: string, opts?: DeleteOptions): Promise<void> {
    return this.inner.delete(key, opts);
  }

  exists(key: string, opts?: ExistsOptions): Promise<boolean> {
    return this.inner.exists(key, opts);
  }

  stat(key: string, opts?: StatOptions): Promise<StorageObject> {
    return this.inner.stat(key, opts);
  }

  getUrl(key: string): string {
    return this.inner.getUrl(key);
  }

  getSignedUrl(key: string, opts?: SignedUrlOptions): Promise<string> {
    return this.inner.getSignedUrl(key, opts);
  }

  copy(sourceKey: string, destKey: string, opts?: CopyOptions): Promise<void> {
    return this.inner.copy(sourceKey, destKey, opts);
  }

  move(sourceKey: string, destKey: string, opts?: MoveOptions): Promise<void> {
    return this.inner.move(sourceKey, destKey, opts);
  }

  listPage(opts?: ListOptions): Promise<ListPage> {
    return this.inner.listPage(opts);
  }

  list(opts?: ListOptions): AsyncIterable<StorageObject> {
    return this.inner.list(opts);
  }

  deleteMany(keys: string[], opts?: DeleteManyOptions): Promise<DeleteManyResult> {
    return this.inner.deleteMany(keys, opts);
  }
}
