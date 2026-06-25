import type { Readable } from 'node:stream';
import type { Disposable, StorageDriver } from './storage-driver.js';
import { type Middleware, type UploadContext } from './middleware-types.js';
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
 * StorageClient is the main entry point users interact with.
 *
 * It composes a `StorageDriver` (Strategy) with an ordered list of
 * `Middleware` (Chain of Responsibility) that runs on every `put()` call.
 * Reads/deletes/stat/list/signed-urls pass straight through to the driver,
 * since the middleware pipeline is scoped to uploads by design — validation,
 * scanning, and transformation concerns apply to incoming data, not
 * outgoing reads.
 *
 * `use()` is immutable: it returns a new `StorageClient` that inherits all
 * existing middlewares plus the new one. The original instance is unchanged,
 * making it safe to share a base client and derive variants from it:
 *
 *   const base = new StorageClient(driver).use(logUploads());
 *   const strict = base.use(validateMimeType({ allowed: ['image/png'] }));
 *   // base still only has logUploads; strict has both
 */
export class StorageClient<D extends StorageDriver = StorageDriver> {
  private readonly middlewares: Middleware[];

  constructor(private readonly driver: D, middlewares: Middleware[] = []) {
    this.middlewares = middlewares;
  }

  /**
   * Returns a new StorageClient that inherits all current middlewares plus
   * the given one appended at the end. The original instance is not modified.
   */
  use(middleware: Middleware): StorageClient<D> {
    return new StorageClient(this.driver, [...this.middlewares, middleware]);
  }

  async put(key: string, data: UploadBody, opts?: PutOptions): Promise<PutResult> {
    const ctx: UploadContext = { key, body: data, options: opts ?? {}, locals: {} };

    const dispatch = (i: number): Promise<void> => {
      if (i === this.middlewares.length) {
        return this.driver.put(ctx.key, ctx.body, ctx.options).then((result) => {
          ctx.result = result;
        });
      }
      // Non-null assertion is safe: i < middlewares.length guarantees the element exists.
      return this.middlewares[i]!(ctx, () => dispatch(i + 1));
    };

    await dispatch(0);

    if (!ctx.result) {
      throw new Error(
        'Middleware pipeline completed without a result — ' +
          'ensure every middleware either calls next() or sets ctx.result directly.',
      );
    }
    return ctx.result;
  }

  get(key: string, opts?: GetOptions): Promise<Readable> {
    return this.driver.get(key, opts);
  }

  delete(key: string, opts?: DeleteOptions): Promise<void> {
    return this.driver.delete(key, opts);
  }

  exists(key: string, opts?: ExistsOptions): Promise<boolean> {
    return this.driver.exists(key, opts);
  }

  stat(key: string, opts?: StatOptions): Promise<StorageObject> {
    return this.driver.stat(key, opts);
  }

  getUrl(key: string): string {
    return this.driver.getUrl(key);
  }

  getSignedUrl(key: string, opts?: SignedUrlOptions): Promise<string> {
    return this.driver.getSignedUrl(key, opts);
  }

  copy(sourceKey: string, destKey: string, opts?: CopyOptions): Promise<void> {
    return this.driver.copy(sourceKey, destKey, opts);
  }

  move(sourceKey: string, destKey: string, opts?: MoveOptions): Promise<void> {
    return this.driver.move(sourceKey, destKey, opts);
  }

  listPage(opts?: ListOptions): Promise<ListPage> {
    return this.driver.listPage(opts);
  }

  list(opts?: ListOptions): AsyncIterable<StorageObject> {
    return this.driver.list(opts);
  }

  deleteMany(keys: string[], opts?: DeleteManyOptions): Promise<DeleteManyResult> {
    return this.driver.deleteMany(keys, opts);
  }

  /**
   * Tears down the underlying driver if it implements Disposable (closes SDK
   * clients, flushes connections, etc.). Safe to call on drivers that don't
   * implement Disposable — it's a no-op in that case.
   */
  async dispose(): Promise<void> {
    if ('dispose' in this.driver && typeof (this.driver as Disposable).dispose === 'function') {
      await (this.driver as Disposable).dispose();
    }
  }

  /**
   * Enables `await using client = new StorageClient(driver)` syntax (TypeScript 5.2+).
   * Calls `dispose()` on the underlying driver if it implements Disposable.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }

  /**
   * Exposes the underlying driver for driver-specific escape hatches.
   * Note: bypasses the middleware pipeline — use only when the operation
   * is not available on StorageClient directly.
   */
  getDriver(): D {
    return this.driver;
  }
}
