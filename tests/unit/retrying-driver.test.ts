import { describe, it, expect, vi } from 'vitest';
import { RetryingDriver, ObjectNotFoundError, AccessDeniedError, StorageClient } from '@restrella/blobpipe';
import { MemoryDriver } from '@restrella/blobpipe-memory';

describe('RetryingDriver', () => {
  it('exposes a name that includes the inner driver name', () => {
    const retrying = new RetryingDriver(new MemoryDriver());
    expect(retrying.name).toBe('retrying(memory)');
  });

  it('succeeds on first attempt when inner driver works', async () => {
    const retrying = new RetryingDriver(new MemoryDriver());
    const client = new StorageClient(retrying);
    const result = await client.put('ok.txt', 'data');
    expect(result.key).toBe('ok.txt');
  });

  it('retries transient errors and eventually succeeds', async () => {
    const inner = new MemoryDriver();
    let attempts = 0;
    const get = inner.get.bind(inner);
    vi.spyOn(inner, 'get').mockImplementation(async (key) => {
      attempts++;
      if (attempts < 3) throw new Error('transient');
      return get(key);
    });

    await inner.put('retry.txt', 'value');
    const retrying = new RetryingDriver(inner, { maxAttempts: 3, baseDelayMs: 1 });
    const stream = await retrying.get('retry.txt');
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
    expect(Buffer.concat(chunks).toString()).toBe('value');
    expect(attempts).toBe(3);
  });

  it('does not retry ObjectNotFoundError', async () => {
    const inner = new MemoryDriver();
    let attempts = 0;
    vi.spyOn(inner, 'get').mockImplementation(async (key) => {
      attempts++;
      throw new ObjectNotFoundError(key, 'memory');
    });

    const retrying = new RetryingDriver(inner, { maxAttempts: 3, baseDelayMs: 1 });
    await expect(retrying.get('missing.txt')).rejects.toBeInstanceOf(ObjectNotFoundError);
    expect(attempts).toBe(1);
  });

  it('does not retry AccessDeniedError', async () => {
    const inner = new MemoryDriver();
    let attempts = 0;
    vi.spyOn(inner, 'stat').mockImplementation(async (key) => {
      attempts++;
      throw new AccessDeniedError(key, 'memory');
    });

    const retrying = new RetryingDriver(inner, { maxAttempts: 3, baseDelayMs: 1 });
    await expect(retrying.stat('secret.txt')).rejects.toBeInstanceOf(AccessDeniedError);
    expect(attempts).toBe(1);
  });

  it('throws after exhausting maxAttempts', async () => {
    const inner = new MemoryDriver();
    let attempts = 0;
    vi.spyOn(inner, 'put').mockImplementation(async () => {
      attempts++;
      throw new Error('always fails');
    });

    const retrying = new RetryingDriver(inner, { maxAttempts: 2, baseDelayMs: 1 });
    await expect(retrying.put('x.txt', 'data')).rejects.toThrow('always fails');
    expect(attempts).toBe(2);
  });
});
