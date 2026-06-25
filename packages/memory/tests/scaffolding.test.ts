import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { MemoryDriver } from '../src/index.js';
import type { StorageDriver } from '@restrella/blobpipe';

async function collect(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

describe('MemoryDriver', () => {
  it('satisfies the StorageDriver interface', () => {
    const driver: StorageDriver = new MemoryDriver();
    expect(driver.name).toBe('memory');
  });

  it('put and get round-trip', async () => {
    const driver = new MemoryDriver();
    await driver.put('hello.txt', 'world');
    expect(await collect(await driver.get('hello.txt'))).toBe('world');
  });

  it('_dump returns a snapshot of stored objects', async () => {
    const driver = new MemoryDriver();
    await driver.put('a.txt', 'aaa');
    const dump = driver._dump();
    expect(dump.size).toBe(1);
    expect(dump.get('a.txt')?.data.toString('utf8')).toBe('aaa');
  });

  it('simulates artificial latency when simulatedLatencyMs is set', async () => {
    const driver = new MemoryDriver({ simulatedLatencyMs: 50 });
    const start = Date.now();
    await driver.put('x.txt', 'x');
    // Allow generous margin for CI timer variance
    expect(Date.now() - start).toBeGreaterThanOrEqual(30);
  });

  it('list respects signal abortion', async () => {
    const driver = new MemoryDriver();
    await driver.put('a.txt', '1');
    const ac = new AbortController();
    ac.abort();
    await expect(async () => {
      for await (const _ of driver.list({ signal: ac.signal })) { /* noop */ }
    }).rejects.toThrow();
  });

  it('listPage respects signal abortion', async () => {
    const driver = new MemoryDriver();
    const ac = new AbortController();
    ac.abort();
    await expect(driver.listPage({ signal: ac.signal })).rejects.toThrow();
  });
});
