import { describe, it, expect, vi } from 'vitest';
import { InstrumentedDriver, ObjectNotFoundError } from '@restrella/blobpipe';
import { MemoryDriver } from '@restrella/blobpipe-memory';

describe('InstrumentedDriver', () => {
  it('includes inner driver name in its own name', () => {
    const d = new InstrumentedDriver(new MemoryDriver(), { onOperation: () => {} });
    expect(d.name).toBe('instrumented(memory)');
  });

  it('calls onOperation after a successful put', async () => {
    const events: unknown[] = [];
    const d = new InstrumentedDriver(new MemoryDriver(), { onOperation: (e) => events.push(e) });
    await d.put('x.txt', 'data');
    expect(events).toHaveLength(1);
    expect((events[0] as { operation: string }).operation).toBe('put');
    expect((events[0] as { error: unknown }).error).toBeUndefined();
  });

  it('records durationMs > 0', async () => {
    const events: unknown[] = [];
    const d = new InstrumentedDriver(new MemoryDriver(), { onOperation: (e) => events.push(e) });
    await d.put('y.txt', 'data');
    expect((events[0] as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records error when operation fails', async () => {
    const events: unknown[] = [];
    const d = new InstrumentedDriver(new MemoryDriver(), { onOperation: (e) => events.push(e) });
    await expect(d.get('missing.txt')).rejects.toBeInstanceOf(ObjectNotFoundError);
    expect(events).toHaveLength(1);
    expect((events[0] as { error: unknown }).error).toBeInstanceOf(ObjectNotFoundError);
  });

  it('still rethrows the original error', async () => {
    const d = new InstrumentedDriver(new MemoryDriver(), { onOperation: () => {} });
    await expect(d.get('ghost.txt')).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('tracks each operation type', async () => {
    const ops: string[] = [];
    const inner = new MemoryDriver();
    const d = new InstrumentedDriver(inner, { onOperation: (e) => ops.push(e.operation) });
    await d.put('f.txt', 'data');
    await d.exists('f.txt');
    await d.stat('f.txt');
    await d.copy('f.txt', 'g.txt');
    await d.delete('f.txt');
    expect(ops).toEqual(['put', 'exists', 'stat', 'copy', 'delete']);
  });
});
