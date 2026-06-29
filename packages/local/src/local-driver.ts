import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { StorageDriver } from '@restrella/blobpipe';
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
} from '@restrella/blobpipe';
import { InvalidKeyError, ObjectAlreadyExistsError, ObjectNotFoundError, StorageOperationError } from '@restrella/blobpipe';
import type { LocalDriverConfig } from './types.js';

async function pLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  let i = 0;
  async function run(): Promise<void> {
    while (i < tasks.length) {
      const idx = i++;
      try {
        results[idx] = { status: 'fulfilled', value: await tasks[idx]!() };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, run));
  return results;
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

function isEexist(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'EEXIST';
}

async function toBuffer(data: UploadBody): Promise<Buffer> {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  const chunks: Buffer[] = [];
  for await (const chunk of data) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * StorageDriver implementation backed by the local filesystem.
 *
 * Keys are mapped to file paths under `rootDir`. Path traversal attempts
 * (keys containing `..`) are rejected with `InvalidKeyError`. Nested
 * directories are created automatically on `put`.
 *
 * `getSignedUrl` returns a plain URL under `publicBaseUrl` — no real
 * signing — intended for local development only.
 */
export class LocalDriver implements StorageDriver {
  readonly name = 'local';
  private readonly rootDir: string;

  constructor(private readonly config: LocalDriverConfig) {
    this.rootDir = resolve(config.rootDir);
  }

  private resolvePath(key: string): string {
    const fullPath = resolve(join(this.rootDir, key));
    const rel = relative(this.rootDir, fullPath);
    if (rel.startsWith('..') || rel.includes('..\\') || rel.includes('../')) {
      throw new InvalidKeyError(key, 'key attempts path traversal outside rootDir', this.name);
    }
    return fullPath;
  }

  async put(key: string, data: UploadBody, opts?: PutOptions): Promise<PutResult> {
    const fullPath = this.resolvePath(key);
    await mkdir(dirname(fullPath), { recursive: true });

    if (data instanceof Readable) {
      // Stream directly to disk — no buffering into memory, handles files of any size.
      let size = 0;
      const hasher = createHash('sha256');
      const onProgress = opts?.onProgress;
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          size += chunk.length;
          hasher.update(chunk);
          onProgress?.(size);
          cb(null, chunk);
        },
      });

      const ws = createWriteStream(fullPath, opts?.ifNoneMatch === '*' ? { flags: 'wx' } : {});
      try {
        await pipeline(data, counter, ws, {
          ...(opts?.signal && { signal: opts.signal }),
        });
      } catch (err) {
        if (opts?.ifNoneMatch === '*' && isEexist(err)) {
          throw new ObjectAlreadyExistsError(key, this.name, { cause: err });
        }
        throw err;
      }

      const checksum = hasher.digest('base64');
      return { key, size, uploadedAt: new Date(), checksum };
    }

    const buffer = await toBuffer(data);
    const checksum = createHash('sha256').update(buffer).digest('base64');

    if (opts?.ifNoneMatch === '*') {
      try {
        await writeFile(fullPath, buffer, { flag: 'wx', ...(opts.signal && { signal: opts.signal }) });
      } catch (err) {
        if (isEexist(err)) {
          throw new ObjectAlreadyExistsError(key, this.name, { cause: err });
        }
        throw err;
      }
    } else {
      await writeFile(fullPath, buffer, opts?.signal ? { signal: opts.signal } : undefined);
    }

    opts?.onProgress?.(buffer.byteLength, buffer.byteLength);
    return { key, size: buffer.byteLength, uploadedAt: new Date(), checksum };
  }

  async get(key: string, opts?: GetOptions): Promise<Readable> {
    opts?.signal?.throwIfAborted();
    const fullPath = this.resolvePath(key);
    try {
      await access(fullPath);
    } catch (err) {
      if (isEnoent(err)) throw new ObjectNotFoundError(key, this.name, { cause: err });
      throw err;
    }
    return createReadStream(fullPath, {
      ...(opts?.start !== undefined && { start: opts.start }),
      ...(opts?.end !== undefined && { end: opts.end }),
    });
  }

  async delete(key: string, opts?: DeleteOptions): Promise<void> {
    opts?.signal?.throwIfAborted();
    const fullPath = this.resolvePath(key);
    try {
      await rm(fullPath);
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }
  }

  async deleteMany(keys: string[], opts?: DeleteManyOptions): Promise<DeleteManyResult> {
    // Fan out with a concurrency cap of 10 to avoid exhausting OS file descriptors.
    // delete is idempotent (ENOENT is swallowed), matching the contract.
    const results = await pLimit(
      keys.map((key) => () => this.delete(key, { ...(opts?.signal && { signal: opts.signal }) })),
      10,
    );

    const deleted: string[] = [];
    const failed: Array<{ key: string; error: unknown }> = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const key = keys[i]!;
      if (result.status === 'fulfilled') {
        deleted.push(key);
      } else {
        failed.push({ key, error: result.reason });
      }
    }

    return { deleted, failed };
  }

  async exists(key: string, opts?: ExistsOptions): Promise<boolean> {
    opts?.signal?.throwIfAborted();
    const fullPath = this.resolvePath(key);
    try {
      await access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async stat(key: string, opts?: StatOptions): Promise<StorageObject> {
    opts?.signal?.throwIfAborted();
    const fullPath = this.resolvePath(key);
    try {
      const s = await stat(fullPath);
      return { key, size: s.size, lastModified: s.mtime };
    } catch (err) {
      if (isEnoent(err)) throw new ObjectNotFoundError(key, this.name, { cause: err });
      throw err;
    }
  }

  getUrl(key: string): string {
    if (!this.config.publicBaseUrl) {
      throw new StorageOperationError(
        'LocalDriver.getUrl() requires `publicBaseUrl` in config.',
        this.name,
      );
    }
    const base = this.config.publicBaseUrl.replace(/\/$/, '');
    return `${base}/${key}`;
  }

  async getSignedUrl(key: string, opts?: SignedUrlOptions): Promise<string> {
    if (!this.config.publicBaseUrl) {
      throw new StorageOperationError(
        'LocalDriver.getSignedUrl() requires `publicBaseUrl` in config. ' +
          'This is a dev-only URL emulation — the returned URL is not cryptographically signed.',
        this.name,
      );
    }
    const expiresAt = Date.now() + (opts?.expiresInSeconds ?? 3600) * 1000;
    const op = opts?.operation ?? 'read';
    const base = this.config.publicBaseUrl.replace(/\/$/, '');
    return `${base}/${key}?op=${op}&expires=${expiresAt}`;
  }

  async copy(sourceKey: string, destKey: string, _opts?: CopyOptions): Promise<void> {
    const src = this.resolvePath(sourceKey);
    const dst = this.resolvePath(destKey);
    try {
      await mkdir(dirname(dst), { recursive: true });
      await copyFile(src, dst);
    } catch (err) {
      if (isEnoent(err)) throw new ObjectNotFoundError(sourceKey, this.name, { cause: err });
      throw err;
    }
  }

  async move(sourceKey: string, destKey: string, opts?: MoveOptions): Promise<void> {
    opts?.signal?.throwIfAborted();
    const src = this.resolvePath(sourceKey);
    const dst = this.resolvePath(destKey);
    try {
      await mkdir(dirname(dst), { recursive: true });
      await rename(src, dst);
    } catch (err) {
      if (isEnoent(err)) throw new ObjectNotFoundError(sourceKey, this.name, { cause: err });
      throw err;
    }
  }

  async listPage(opts?: ListOptions): Promise<ListPage> {
    opts?.signal?.throwIfAborted();
    const prefix = opts?.prefix ?? '';
    const limit = opts?.limit;
    // cursor encodes the last-seen key for offset-based pagination on the local fs
    const afterKey = opts?.cursor ?? '';
    const items: StorageObject[] = [];

    for await (const key of this.walk(this.rootDir)) {
      if (prefix && !key.startsWith(prefix)) continue;
      if (afterKey && key <= afterKey) continue;
      const s = await stat(join(this.rootDir, key));
      items.push({ key, size: s.size, lastModified: s.mtime });
      if (limit !== undefined && items.length >= limit) {
        return { items, nextCursor: key };
      }
    }

    return { items };
  }

  async *list(opts?: ListOptions): AsyncIterable<StorageObject> {
    opts?.signal?.throwIfAborted();
    const prefix = opts?.prefix ?? '';
    const limit = opts?.limit;
    let count = 0;

    for await (const key of this.walk(this.rootDir)) {
      if (limit !== undefined && count >= limit) return;
      if (prefix && !key.startsWith(prefix)) continue;
      const s = await stat(join(this.rootDir, key));
      yield { key, size: s.size, lastModified: s.mtime };
      count++;
    }
  }

  private async *walk(dir: string): AsyncGenerator<string> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (isEnoent(err)) return;
      throw err;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        yield* this.walk(fullPath);
      } else if (entry.isFile()) {
        yield relative(this.rootDir, fullPath).replace(/\\/g, '/');
      }
    }
  }
}
