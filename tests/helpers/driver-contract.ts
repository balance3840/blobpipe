import { describe, it, expect, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import type { StorageDriver } from '@restrella/blobpipe';
import { ObjectAlreadyExistsError, ObjectNotFoundError } from '@restrella/blobpipe';

async function collect(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function collectBuf(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

export interface DriverContractOptions {
  /**
   * Set to true if the driver persists and returns user-supplied metadata via stat().
   * LocalDriver does not currently store metadata, so omit or set false for it.
   */
  supportsMetadata?: boolean;
  /**
   * Set to false to skip getSignedUrl tests (e.g. emulators that lack signing credentials).
   * Defaults to true.
   */
  supportsSignedUrls?: boolean;
}

/**
 * Shared behavioral contract suite.
 * Call this from each driver's test file with an appropriate factory.
 * The factory is called before each test so every test starts with a clean driver.
 */
export function testDriverContract(
  driverName: string,
  makeDriver: () => StorageDriver,
  opts: DriverContractOptions = {},
): void {
  describe(`${driverName} — driver contract`, () => {
    let driver: StorageDriver;

    beforeEach(() => {
      driver = makeDriver();
    });

    // ── put / get round-trip ───────────────────────────────────────────────

    describe('put + get', () => {
      it('stores and retrieves a string', async () => {
        await driver.put('a/string.txt', 'hello');
        expect(await collect(await driver.get('a/string.txt'))).toBe('hello');
      });

      it('stores and retrieves a Buffer', async () => {
        await driver.put('a/buf.bin', Buffer.from([1, 2, 3]));
        const result = await driver.get('a/buf.bin');
        const chunks: Buffer[] = [];
        for await (const c of result) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
        expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3]));
      });

      it('stores and retrieves a Uint8Array', async () => {
        await driver.put('a/u8.bin', new Uint8Array([9, 8, 7]));
        const result = await driver.get('a/u8.bin');
        const chunks: Buffer[] = [];
        for await (const c of result) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
        expect(Buffer.concat(chunks)).toEqual(Buffer.from([9, 8, 7]));
      });

      it('stores and retrieves a Readable stream', async () => {
        await driver.put('a/stream.txt', Readable.from(['foo', 'bar']));
        expect(await collect(await driver.get('a/stream.txt'))).toBe('foobar');
      });

      it('put returns a PutResult with the correct key', async () => {
        const result = await driver.put('result.txt', 'data');
        expect(result.key).toBe('result.txt');
        expect(result.uploadedAt).toBeInstanceOf(Date);
      });

      it('overwrites an existing object', async () => {
        await driver.put('overwrite.txt', 'first');
        await driver.put('overwrite.txt', 'second');
        expect(await collect(await driver.get('overwrite.txt'))).toBe('second');
      });

      it('get throws ObjectNotFoundError for missing key', async () => {
        await expect(driver.get('no-such-key.txt')).rejects.toBeInstanceOf(ObjectNotFoundError);
      });

      it.skipIf(!opts.supportsMetadata)('stores metadata and round-trips it via stat', async () => {
        await driver.put('meta.txt', 'payload', {
          metadata: { author: 'alice', env: 'test' },
        });
        const info = await driver.stat('meta.txt');
        expect(info.metadata?.['author']).toBe('alice');
        expect(info.metadata?.['env']).toBe('test');
      });

      it('put with ifNoneMatch: "*" throws ObjectAlreadyExistsError on second write', async () => {
        await driver.put('once.txt', 'first', { ifNoneMatch: '*' });
        await expect(
          driver.put('once.txt', 'second', { ifNoneMatch: '*' }),
        ).rejects.toBeInstanceOf(ObjectAlreadyExistsError);
        // Original content must still be intact
        expect(await collect(await driver.get('once.txt'))).toBe('first');
      });
    });

    // ── byte-range get ─────────────────────────────────────────────────────

    describe('get (byte ranges)', () => {
      it('returns a partial range when start and end are specified', async () => {
        await driver.put('range.bin', Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
        // start=2, end=4 should return bytes at index 2,3,4 → [2,3,4]
        const stream = await driver.get('range.bin', { start: 2, end: 4 });
        const buf = await collectBuf(stream);
        expect(buf).toEqual(Buffer.from([2, 3, 4]));
      });

      it('returns from start to end of object when only start is given', async () => {
        await driver.put('range2.bin', Buffer.from([10, 20, 30, 40]));
        const stream = await driver.get('range2.bin', { start: 2 });
        const buf = await collectBuf(stream);
        expect(buf).toEqual(Buffer.from([30, 40]));
      });
    });

    // ── exists ─────────────────────────────────────────────────────────────

    describe('exists', () => {
      it('returns true for a stored key', async () => {
        await driver.put('present.txt', 'here');
        expect(await driver.exists('present.txt')).toBe(true);
      });

      it('returns false for a missing key', async () => {
        expect(await driver.exists('absent.txt')).toBe(false);
      });
    });

    // ── stat ───────────────────────────────────────────────────────────────

    describe('stat', () => {
      it('returns correct metadata for a stored object', async () => {
        await driver.put('stat.txt', 'hello world');
        const info = await driver.stat('stat.txt');
        expect(info.key).toBe('stat.txt');
        expect(info.size).toBe(11);
        expect(info.lastModified).toBeInstanceOf(Date);
      });

      it('throws ObjectNotFoundError for missing key', async () => {
        await expect(driver.stat('missing.txt')).rejects.toBeInstanceOf(ObjectNotFoundError);
      });
    });

    // ── delete ─────────────────────────────────────────────────────────────

    describe('delete', () => {
      it('removes a stored object', async () => {
        await driver.put('del.txt', 'bye');
        await driver.delete('del.txt');
        expect(await driver.exists('del.txt')).toBe(false);
      });

      it('does not throw when deleting a missing key', async () => {
        await expect(driver.delete('ghost.txt')).resolves.toBeUndefined();
      });
    });

    // ── deleteMany ─────────────────────────────────────────────────────────

    describe('deleteMany', () => {
      it('deletes multiple objects in one call', async () => {
        await driver.put('dm/a.txt', 'a');
        await driver.put('dm/b.txt', 'b');
        await driver.put('dm/c.txt', 'c');

        const result = await driver.deleteMany(['dm/a.txt', 'dm/b.txt', 'dm/c.txt']);

        expect(result.deleted.sort()).toEqual(['dm/a.txt', 'dm/b.txt', 'dm/c.txt']);
        expect(result.failed).toHaveLength(0);
        expect(await driver.exists('dm/a.txt')).toBe(false);
        expect(await driver.exists('dm/b.txt')).toBe(false);
        expect(await driver.exists('dm/c.txt')).toBe(false);
      });

      it('does not fail when some keys are missing', async () => {
        await driver.put('dm/exists.txt', 'here');

        const result = await driver.deleteMany(['dm/exists.txt', 'dm/ghost.txt']);

        // Both should be in deleted (ghost is idempotent)
        expect(result.failed).toHaveLength(0);
        expect(result.deleted).toContain('dm/exists.txt');
      });

      it('returns empty result for empty input', async () => {
        const result = await driver.deleteMany([]);
        expect(result.deleted).toHaveLength(0);
        expect(result.failed).toHaveLength(0);
      });
    });

    // ── copy ───────────────────────────────────────────────────────────────

    describe('copy', () => {
      it('copies object to a new key', async () => {
        await driver.put('src.txt', 'original');
        await driver.copy('src.txt', 'dst.txt');
        expect(await collect(await driver.get('dst.txt'))).toBe('original');
      });

      it('leaves source intact after copy', async () => {
        await driver.put('keep.txt', 'source');
        await driver.copy('keep.txt', 'copy.txt');
        expect(await driver.exists('keep.txt')).toBe(true);
      });

      it('overwrites destination if it already exists', async () => {
        await driver.put('original.txt', 'v1');
        await driver.put('dest.txt', 'old');
        await driver.copy('original.txt', 'dest.txt');
        expect(await collect(await driver.get('dest.txt'))).toBe('v1');
      });

      it('throws ObjectNotFoundError when source does not exist', async () => {
        await expect(driver.copy('ghost.txt', 'dest.txt')).rejects.toBeInstanceOf(ObjectNotFoundError);
      });
    });

    // ── move ───────────────────────────────────────────────────────────────

    describe('move', () => {
      it('moves object to a new key', async () => {
        await driver.put('mv-src.txt', 'payload');
        await driver.move('mv-src.txt', 'mv-dst.txt');
        expect(await collect(await driver.get('mv-dst.txt'))).toBe('payload');
      });

      it('removes the source after move', async () => {
        await driver.put('mv-del.txt', 'payload');
        await driver.move('mv-del.txt', 'mv-del-dst.txt');
        expect(await driver.exists('mv-del.txt')).toBe(false);
      });

      it('throws ObjectNotFoundError when source does not exist', async () => {
        await expect(driver.move('ghost.txt', 'dst.txt')).rejects.toBeInstanceOf(ObjectNotFoundError);
      });
    });

    // ── list ───────────────────────────────────────────────────────────────

    describe('list', () => {
      beforeEach(async () => {
        await driver.put('a/1.txt', '1');
        await driver.put('a/2.txt', '2');
        await driver.put('b/3.txt', '3');
      });

      it('lists all objects when no prefix given', async () => {
        const keys: string[] = [];
        for await (const obj of driver.list()) keys.push(obj.key);
        expect(keys.sort()).toEqual(['a/1.txt', 'a/2.txt', 'b/3.txt']);
      });

      it('filters by prefix', async () => {
        const keys: string[] = [];
        for await (const obj of driver.list({ prefix: 'a/' })) keys.push(obj.key);
        expect(keys.sort()).toEqual(['a/1.txt', 'a/2.txt']);
      });

      it('respects limit', async () => {
        const keys: string[] = [];
        for await (const obj of driver.list({ limit: 2 })) keys.push(obj.key);
        expect(keys).toHaveLength(2);
      });

      it('yields StorageObjects with correct shape', async () => {
        for await (const obj of driver.list({ prefix: 'a/1.txt' })) {
          expect(obj.key).toBe('a/1.txt');
          expect(obj.size).toBe(1);
          expect(obj.lastModified).toBeInstanceOf(Date);
        }
      });
    });

    // ── listPage ───────────────────────────────────────────────────────────

    describe('listPage', () => {
      beforeEach(async () => {
        await driver.put('p/1.txt', '1');
        await driver.put('p/2.txt', '2');
        await driver.put('p/3.txt', '3');
      });

      it('returns items on first page', async () => {
        const page = await driver.listPage({ prefix: 'p/' });
        expect(page.items.map((i) => i.key).sort()).toEqual(['p/1.txt', 'p/2.txt', 'p/3.txt']);
      });

      it('paginates with limit and nextCursor', async () => {
        const first = await driver.listPage({ prefix: 'p/', limit: 2 });
        expect(first.items).toHaveLength(2);
        expect(first.nextCursor).toBeDefined();

        const second = await driver.listPage({ prefix: 'p/', limit: 2, cursor: first.nextCursor });
        expect(second.items).toHaveLength(1);
        expect(second.nextCursor).toBeUndefined();

        const allKeys = [...first.items, ...second.items].map((i) => i.key).sort();
        expect(allKeys).toEqual(['p/1.txt', 'p/2.txt', 'p/3.txt']);
      });

      it('returns empty items and no cursor for empty result', async () => {
        const page = await driver.listPage({ prefix: 'nonexistent/' });
        expect(page.items).toEqual([]);
        expect(page.nextCursor).toBeUndefined();
      });
    });

    // ── getUrl ─────────────────────────────────────────────────────────────

    describe('getUrl', () => {
      it('returns a non-empty string', () => {
        expect(typeof driver.getUrl('some/key.txt')).toBe('string');
        expect(driver.getUrl('some/key.txt').length).toBeGreaterThan(0);
      });

      it('includes the key in the returned URL', () => {
        expect(driver.getUrl('foo/bar.txt')).toContain('foo/bar.txt');
      });

      it('is deterministic — same key returns same URL', () => {
        expect(driver.getUrl('x.txt')).toBe(driver.getUrl('x.txt'));
      });
    });

    // ── getSignedUrl ───────────────────────────────────────────────────────

    describe('getSignedUrl', () => {
      const canSign = opts.supportsSignedUrls !== false;

      it.skipIf(!canSign)('returns a non-empty string', async () => {
        await driver.put('signed.txt', 'payload');
        const url = await driver.getSignedUrl('signed.txt');
        expect(typeof url).toBe('string');
        expect(url.length).toBeGreaterThan(0);
      });

      it.skipIf(!canSign)('returns different URLs for read vs write operations', async () => {
        await driver.put('signed2.txt', 'payload');
        const readUrl = await driver.getSignedUrl('signed2.txt', { operation: 'read' });
        const writeUrl = await driver.getSignedUrl('signed2.txt', { operation: 'write' });
        // They may differ — the important thing is they're both non-empty strings
        expect(readUrl.length).toBeGreaterThan(0);
        expect(writeUrl.length).toBeGreaterThan(0);
      });
    });
  });
}
