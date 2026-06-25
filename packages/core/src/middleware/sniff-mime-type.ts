import { PassThrough, Readable } from 'node:stream';
import type { Middleware } from '../core/middleware-types.js';

export interface SniffMimeTypeOptions {
  /** If true, overrides an already-declared contentType. Defaults to false. */
  override?: boolean;
}

function peekReadable(stream: Readable, maxBytes: number): Promise<[Buffer, Readable]> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      stream.pause();
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      const all = Buffer.concat(chunks);
      const peeked = all.subarray(0, maxBytes);
      stream.unshift(all); // put bytes back
      const pass = new PassThrough();
      stream.pipe(pass);
      stream.resume();
      resolve([peeked, pass]);
    };

    const onData = (chunk: Buffer | Uint8Array) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      total += buf.length;
      if (total >= maxBytes) settle();
    };
    const onEnd = () => settle();
    const onError = (err: unknown) => { settled = true; reject(err); };

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });
}

export function sniffMimeType(opts?: SniffMimeTypeOptions): Middleware {
  // Kick off the import immediately so:
  // 1. The result is cached — no re-import overhead on subsequent uploads.
  // 2. A missing package surfaces as early as possible (at configuration time)
  //    rather than silently on the first upload.
  const fileTypePromise = (
    import('file-type') as Promise<{
      fileTypeFromBuffer: (buf: Uint8Array) => Promise<{ mime: string } | undefined>;
    }>
  ).then((ft) => ft.fileTypeFromBuffer);

  return async (ctx, next) => {
    if (ctx.options.contentType && opts?.override !== true) {
      await next();
      return;
    }

    let fileTypeFromBuffer: (buf: Uint8Array) => Promise<{ mime: string } | undefined>;
    try {
      fileTypeFromBuffer = await fileTypePromise;
    } catch {
      throw new Error(
        'sniffMimeType middleware requires the "file-type" package to be installed. ' +
          'Run: npm install file-type',
      );
    }

    const data = ctx.body;

    if (data instanceof Readable) {
      const [peeked, reconstructed] = await peekReadable(data, 4100);
      ctx.body = reconstructed;
      const detected = await fileTypeFromBuffer(peeked);
      if (detected) {
        ctx.options = { ...ctx.options, contentType: detected.mime };
      }
    } else {
      const buf = Buffer.isBuffer(data)
        ? data
        : data instanceof Uint8Array
          ? Buffer.from(data)
          : Buffer.from(data, 'utf8');
      const detected = await fileTypeFromBuffer(buf);
      if (detected) {
        ctx.options = { ...ctx.options, contentType: detected.mime };
      }
    }

    await next();
  };
}
