import { Readable } from 'node:stream';
import { MiddlewareRejectionError, type MiddlewareFactory } from '../core/middleware-types.js';

export interface MaxFileSizeOptions {
  /** Maximum allowed payload size, in bytes. */
  maxBytes: number;
}

/**
 * Rejects uploads whose body exceeds `maxBytes`.
 *
 * For Buffer/Uint8Array/string bodies: synchronous byte-length check before
 * the driver is invoked.
 *
 * For Readable streams: the stream is consumed and buffered up to `maxBytes`.
 * If the limit is crossed the upload is rejected immediately; otherwise
 * `ctx.body` is replaced with the collected Buffer so downstream middleware
 * and the driver see a known-length body (avoiding a second pass over the
 * stream). This is acceptable because `maxBytes` is by definition a small
 * enough threshold to hold in memory.
 */
export const maxFileSize: MiddlewareFactory<MaxFileSizeOptions> = (options) => {
  return async (ctx, next) => {
    const data = ctx.body;

    if (data instanceof Readable) {
      const chunks: Buffer[] = [];
      let total = 0;

      for await (const chunk of data) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        total += buf.byteLength;
        if (total > options.maxBytes) {
          throw new MiddlewareRejectionError(
            `Upload for "${ctx.key}" was rejected: stream exceeded the maximum allowed size of ${options.maxBytes} bytes.`,
            'FILE_TOO_LARGE',
          );
        }
        chunks.push(buf);
      }

      ctx.body = Buffer.concat(chunks);
    } else {
      const size = Buffer.isBuffer(data)
        ? data.byteLength
        : data instanceof Uint8Array
          ? data.byteLength
          : Buffer.byteLength(data, 'utf8');

      if (size > options.maxBytes) {
        throw new MiddlewareRejectionError(
          `Upload for "${ctx.key}" was rejected: body is ${size} bytes, exceeds the maximum of ${options.maxBytes} bytes.`,
          'FILE_TOO_LARGE',
        );
      }
    }

    await next();
  };
};
