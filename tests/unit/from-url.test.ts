import { describe, it, expect, vi, afterEach } from 'vitest';
import { fromUrl } from '@restrella/blobpipe';

async function collect(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString('utf8');
}

describe('fromUrl — scheme validation', () => {
  it('throws for ftp:// URLs', async () => {
    await expect(fromUrl('ftp://example.com/file')).rejects.toThrow(
      /unsupported URL scheme/i,
    );
  });

  it('throws for file:// URLs', async () => {
    await expect(fromUrl('file:///etc/passwd')).rejects.toThrow(
      /unsupported URL scheme/i,
    );
  });

  it('throws for data: URLs', async () => {
    await expect(fromUrl('data:text/plain,hello')).rejects.toThrow(
      /unsupported URL scheme/i,
    );
  });
});

describe('fromUrl — return shape', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  afterEach(() => {
    fetchSpy.mockReset();
  });

  function makeFakeResponse(body: string, contentType: string | null = 'text/plain') {
    const encoder = new TextEncoder();
    const buf = encoder.encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) { ctrl.enqueue(buf); ctrl.close(); },
    });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      body: stream,
      headers: {
        get(name: string) {
          if (name.toLowerCase() === 'content-type') return contentType;
          if (name.toLowerCase() === 'content-length') return String(buf.byteLength);
          return null;
        },
      },
    } as unknown as Response;
  }

  it('returns body and contentType when Content-Type header is present', async () => {
    fetchSpy.mockResolvedValueOnce(makeFakeResponse('hello', 'text/html; charset=utf-8'));
    const result = await fromUrl('https://example.com/page');
    expect(result.contentType).toBe('text/html');
    expect(await collect(result.body)).toBe('hello');
  });

  it('returns body without contentType when Content-Type header is absent', async () => {
    fetchSpy.mockResolvedValueOnce(makeFakeResponse('raw', null));
    const result = await fromUrl('https://example.com/raw');
    expect(result.contentType).toBeUndefined();
    expect(await collect(result.body)).toBe('raw');
  });

  it('strips charset parameter from Content-Type', async () => {
    fetchSpy.mockResolvedValueOnce(makeFakeResponse('x', 'application/json; charset=utf-8'));
    const { contentType } = await fromUrl('https://example.com/data.json');
    expect(contentType).toBe('application/json');
  });

  it('throws when response is not ok', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      body: null,
      headers: { get: () => null },
    } as unknown as Response);
    await expect(fromUrl('https://example.com/missing')).rejects.toThrow('404');
  });

  it('rejects when Content-Length exceeds maxBytes', async () => {
    fetchSpy.mockResolvedValueOnce(makeFakeResponse('a'.repeat(200), 'text/plain'));
    await expect(fromUrl('https://example.com/big', { maxBytes: 10 })).rejects.toThrow(
      /maxBytes/i,
    );
  });
});
