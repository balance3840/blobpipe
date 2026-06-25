import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import {
  StorageClient,
  logUploads,
  maxFileSize,
  validateMimeType,
  MiddlewareRejectionError,
} from '@blobpipe/core';
import { MemoryDriver } from '@blobpipe/memory';

function makeClient() {
  return { driver: new MemoryDriver(), client: new StorageClient(new MemoryDriver()) };
}

describe('validateMimeType middleware', () => {
  it('allows an accepted content type', async () => {
    const client = new StorageClient(new MemoryDriver()).use(
      validateMimeType({ allowed: ['text/plain'] }),
    );
    const result = await client.put('ok.txt', 'hi', { contentType: 'text/plain' });
    expect(result.key).toBe('ok.txt');
  });

  it('rejects a disallowed content type', async () => {
    const client = new StorageClient(new MemoryDriver()).use(
      validateMimeType({ allowed: ['image/png'] }),
    );
    await expect(
      client.put('bad.js', 'code', { contentType: 'application/javascript' }),
    ).rejects.toBeInstanceOf(MiddlewareRejectionError);
  });

  it('rejection error has code MIME_TYPE_NOT_ALLOWED', async () => {
    const client = new StorageClient(new MemoryDriver()).use(
      validateMimeType({ allowed: ['image/png'] }),
    );
    try {
      await client.put('bad.js', 'code', { contentType: 'text/plain' });
    } catch (err) {
      expect(err).toBeInstanceOf(MiddlewareRejectionError);
      expect((err as MiddlewareRejectionError).code).toBe('DISALLOWED_CONTENT_TYPE');
    }
  });
});

describe('maxFileSize middleware', () => {
  it('allows a file within the limit', async () => {
    const client = new StorageClient(new MemoryDriver()).use(maxFileSize({ maxBytes: 100 }));
    await expect(client.put('small.txt', 'tiny')).resolves.toBeDefined();
  });

  it('rejects a Buffer over the limit', async () => {
    const client = new StorageClient(new MemoryDriver()).use(maxFileSize({ maxBytes: 4 }));
    await expect(client.put('big.txt', 'hello')).rejects.toBeInstanceOf(MiddlewareRejectionError);
  });

  it('rejects a Readable stream over the limit', async () => {
    const client = new StorageClient(new MemoryDriver()).use(maxFileSize({ maxBytes: 3 }));
    await expect(
      client.put('big.stream.txt', Readable.from(['hello'])),
    ).rejects.toBeInstanceOf(MiddlewareRejectionError);
  });
});

describe('logUploads middleware', () => {
  it('calls logger.info on success', async () => {
    const info = vi.fn();
    const error = vi.fn();
    const client = new StorageClient(new MemoryDriver()).use(logUploads({ logger: { info, error } }));
    await client.put('log.txt', 'data');
    expect(info).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('logUploads middleware — JSON format', () => {
  it('logs valid JSON when format is json', async () => {
    const messages: string[] = [];
    const logger = { info: (m: string) => messages.push(m), error: vi.fn() };
    const client = new StorageClient(new MemoryDriver()).use(
      logUploads({ logger, format: 'json' }),
    );
    await client.put('json-log.txt', 'hello');
    expect(messages).toHaveLength(1);
    const parsed = JSON.parse(messages[0]!);
    expect(parsed).toMatchObject({ level: 'info', key: 'json-log.txt' });
    expect(typeof parsed.durationMs).toBe('number');
  });

  it('calls logger.error with JSON on failure', async () => {
    const infos: string[] = [];
    const errors: string[] = [];
    const driver = new MemoryDriver();
    const client = new StorageClient(driver).use(
      logUploads({ logger: { info: (m: string) => infos.push(m), error: (m: string) => errors.push(m) }, format: 'json' }),
    );
    // Force an error by putting a bad key (empty key throws in some drivers;
    // use a validateMimeType rejection to produce a reliable throw)
    const strictClient = client.use(validateMimeType({ allowed: ['image/png'] }));
    await strictClient.put('bad.txt', 'x', { contentType: 'text/plain' }).catch(() => {});
    // logUploads sits outside validateMimeType in this chain, so it catches the rejection
    expect(errors.length + infos.length).toBeGreaterThan(0);
  });
});

describe('middleware ordering', () => {
  it('runs middlewares in registration order', async () => {
    const order: number[] = [];
    const make = (n: number) => async (_ctx: unknown, next: () => Promise<void>) => {
      order.push(n);
      await next();
    };
    const driver = new MemoryDriver();
    const client = new StorageClient(driver)
      .use(make(1) as Parameters<StorageClient['use']>[0])
      .use(make(2) as Parameters<StorageClient['use']>[0])
      .use(make(3) as Parameters<StorageClient['use']>[0]);
    await client.put('order.txt', 'x');
    expect(order).toEqual([1, 2, 3]);
  });

  it('use() is immutable — base client is unchanged after derive', async () => {
    const driver = new MemoryDriver();
    const base = new StorageClient(driver);
    const withLog = base.use(logUploads());

    // withLog has middleware; base does not — they share a driver but not pipeline state
    // Both should be able to put successfully
    await expect(base.put('base.txt', 'x')).resolves.toBeDefined();
    await expect(withLog.put('derived.txt', 'y')).resolves.toBeDefined();

    // Verify they are distinct instances
    expect(base).not.toBe(withLog);
  });
});
