import type { Readable } from 'node:stream';
import { StorageDriverDecorator } from '../core/storage-driver-decorator.js';
import type { StorageDriver } from '../core/storage-driver.js';
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
} from '../core/types.js';
import { AccessDeniedError, InvalidKeyError, ObjectNotFoundError } from '../errors/storage-errors.js';

export interface RetryOptions {
  /** Maximum number of attempts, including the first. Defaults to 3. */
  maxAttempts?: number;
  /** Base delay in ms used for exponential backoff between attempts. Defaults to 200. */
  baseDelayMs?: number;
  /**
   * Predicate deciding whether a given error should trigger a retry.
   * Defaults to retrying all errors except ObjectNotFoundError,
   * AccessDeniedError, and InvalidKeyError — those are semantic failures
   * that won't resolve on retry.
   */
  shouldRetry?: (error: unknown) => boolean;
}

function defaultShouldRetry(error: unknown): boolean {
  if (error instanceof ObjectNotFoundError) return false;
  if (error instanceof AccessDeniedError) return false;
  if (error instanceof InvalidKeyError) return false;
  return true;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Decorator that wraps any StorageDriver with retry-with-exponential-backoff.
 *
 * Retries `put`, `get`, `delete`, `exists`, and `stat`. Leaves `list` and
 * `getSignedUrl` as base-class passthroughs — `list` is a stateful async
 * iterator that can't be safely rewound mid-page, and `getSignedUrl` is
 * typically pure computation with no I/O to retry.
 *
 * Usage:
 *   const storage = new RetryingDriver(new S3Driver(config), { maxAttempts: 5 });
 */
export class RetryingDriver extends StorageDriverDecorator {
  readonly name: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly shouldRetry: (error: unknown) => boolean;

  constructor(inner: StorageDriver, options: RetryOptions = {}) {
    super(inner);
    this.name = `retrying(${inner.name})`;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 200;
    this.shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt === this.maxAttempts || !this.shouldRetry(err)) throw err;
        // Exponential backoff with up to 25% jitter to avoid thundering herd.
        const base = this.baseDelayMs * 2 ** (attempt - 1);
        await sleep(base + Math.random() * base * 0.25);
      }
    }

    throw lastError;
  }

  override put(key: string, data: UploadBody, opts?: PutOptions): Promise<PutResult> {
    return this.withRetry(() => this.inner.put(key, data, opts));
  }

  override get(key: string, opts?: GetOptions): Promise<Readable> {
    return this.withRetry(() => this.inner.get(key, opts));
  }

  override delete(key: string, opts?: DeleteOptions): Promise<void> {
    return this.withRetry(() => this.inner.delete(key, opts));
  }

  override exists(key: string, opts?: ExistsOptions): Promise<boolean> {
    return this.withRetry(() => this.inner.exists(key, opts));
  }

  override stat(key: string, opts?: StatOptions): Promise<StorageObject> {
    return this.withRetry(() => this.inner.stat(key, opts));
  }

  override copy(sourceKey: string, destKey: string, opts?: CopyOptions): Promise<void> {
    return this.withRetry(() => this.inner.copy(sourceKey, destKey, opts));
  }

  override move(sourceKey: string, destKey: string, opts?: MoveOptions): Promise<void> {
    return this.withRetry(() => this.inner.move(sourceKey, destKey, opts));
  }

  override listPage(opts?: ListOptions): Promise<ListPage> {
    return this.withRetry(() => this.inner.listPage(opts));
  }

  override deleteMany(keys: string[], opts?: DeleteManyOptions): Promise<DeleteManyResult> {
    return this.withRetry(() => this.inner.deleteMany(keys, opts));
  }

  // list and getSignedUrl delegate to the base class passthrough.
  // list: async iterators can't be safely rewound mid-page after a failure.
  // getSignedUrl: pure computation in most drivers, no I/O to retry.
  override getSignedUrl(key: string, opts?: SignedUrlOptions): Promise<string> {
    return this.inner.getSignedUrl(key, opts);
  }
}
