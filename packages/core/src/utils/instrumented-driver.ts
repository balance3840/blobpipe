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
  StatOptions,
  StorageObject,
} from '../core/types.js';

export interface OperationEvent {
  /** The driver name, e.g. "s3", "azure-blob". */
  driver: string;
  /** The operation that was performed, e.g. "put", "get", "copy". */
  operation: string;
  /** The primary key involved in the operation. For copy this is the source key. */
  key: string;
  /** Wall-clock duration of the operation in milliseconds. */
  durationMs: number;
  /** Set when the operation threw; undefined on success. */
  error?: unknown;
}

export interface InstrumentedDriverOptions {
  /** Called after every driver operation completes (success or failure). */
  onOperation: (event: OperationEvent) => void;
}

/**
 * Decorator that wraps any StorageDriver and emits timing + error events for
 * every operation. Wire this up to your metrics system, OpenTelemetry, or
 * a simple logger — the library stays dependency-free, you own the sink.
 *
 * Usage:
 *   const storage = new InstrumentedDriver(new S3Driver(config), {
 *     onOperation: ({ operation, durationMs, error }) =>
 *       metrics.histogram('blobpipe.operation', durationMs, { operation, ok: !error }),
 *   });
 */
export class InstrumentedDriver extends StorageDriverDecorator {
  readonly name: string;
  protected readonly onOperation: (event: OperationEvent) => void;

  constructor(inner: StorageDriver, options: InstrumentedDriverOptions) {
    super(inner);
    this.name = `instrumented(${inner.name})`;
    this.onOperation = options.onOperation;
  }

  private async track<T>(operation: string, key: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.onOperation({ driver: this.inner.name, operation, key, durationMs: Date.now() - start });
      return result;
    } catch (error) {
      this.onOperation({ driver: this.inner.name, operation, key, durationMs: Date.now() - start, error });
      throw error;
    }
  }

  override put(key: string, data: Parameters<StorageDriver['put']>[1], opts?: PutOptions): Promise<PutResult> {
    return this.track('put', key, () => this.inner.put(key, data, opts));
  }

  override get(key: string, opts?: GetOptions): Promise<Readable> {
    return this.track('get', key, () => this.inner.get(key, opts));
  }

  override delete(key: string, opts?: DeleteOptions): Promise<void> {
    return this.track('delete', key, () => this.inner.delete(key, opts));
  }

  override exists(key: string, opts?: ExistsOptions): Promise<boolean> {
    return this.track('exists', key, () => this.inner.exists(key, opts));
  }

  override stat(key: string, opts?: StatOptions): Promise<StorageObject> {
    return this.track('stat', key, () => this.inner.stat(key, opts));
  }

  override copy(sourceKey: string, destKey: string, opts?: CopyOptions): Promise<void> {
    return this.track('copy', sourceKey, () => this.inner.copy(sourceKey, destKey, opts));
  }

  override move(sourceKey: string, destKey: string, opts?: MoveOptions): Promise<void> {
    return this.track('move', sourceKey, () => this.inner.move(sourceKey, destKey, opts));
  }

  override listPage(opts?: ListOptions): Promise<ListPage> {
    return this.track('listPage', opts?.prefix ?? '', () => this.inner.listPage(opts));
  }

  override deleteMany(keys: string[], opts?: DeleteManyOptions): Promise<DeleteManyResult> {
    return this.track('deleteMany', keys[0] ?? '', () => this.inner.deleteMany(keys, opts));
  }

  override list(opts?: ListOptions): AsyncIterable<StorageObject> {
    const start = Date.now();
    const key = opts?.prefix ?? '';
    const driverName = this.inner.name;
    const emit = this.onOperation;
    const inner = this.inner.list(opts);

    return {
      [Symbol.asyncIterator]() {
        const iter = inner[Symbol.asyncIterator]();
        let emitted = false;
        const done = (error?: unknown) => {
          if (emitted) return;
          emitted = true;
          emit({ driver: driverName, operation: 'list', key, durationMs: Date.now() - start, ...(error !== undefined && { error }) });
        };
        return {
          async next() {
            try {
              const result = await iter.next();
              if (result.done) done();
              return result;
            } catch (error) {
              done(error);
              throw error;
            }
          },
          async return(value?: unknown) {
            done();
            if (iter.return) return iter.return(value);
            return { done: true as const, value: value as undefined };
          },
        };
      },
    };
  }
}
