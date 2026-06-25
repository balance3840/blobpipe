import type { Middleware } from '../core/middleware-types.js';

export interface LogUploadsOptions {
  /** Logger to use. Defaults to `console` if omitted. */
  logger?: Pick<typeof console, 'info' | 'error'>;
  /**
   * Output format.
   * - `'text'` (default): human-readable string, e.g. `[blobpipe] PUT "key" — 1024 bytes in 42ms`
   * - `'json'`: structured JSON string with `level`, `msg`, `key`, `durationMs`, and (on success)
   *   `size` / `etag` fields. Wire this to your log aggregator (Datadog, CloudWatch, etc.).
   */
  format?: 'text' | 'json';
}

/**
 * Logs the outcome of every upload.
 *
 * Runs as an "around" middleware: calls `next()` first (which eventually
 * invokes the driver), then reads `ctx.result` on the way back out to log
 * success, or catches and re-throws to log failures.
 */
export function logUploads(options: LogUploadsOptions = {}): Middleware {
  const logger = options.logger ?? console;
  const format = options.format ?? 'text';

  return async (ctx, next) => {
    const start = Date.now();
    try {
      await next();
      const { result } = ctx;
      const durationMs = Date.now() - start;

      if (format === 'json') {
        logger.info(JSON.stringify({
          level: 'info',
          msg: 'blobpipe PUT ok',
          key: ctx.key,
          durationMs,
          ...(result?.size !== undefined && { size: result.size }),
          ...(result?.etag && { etag: result.etag }),
        }));
      } else {
        logger.info(
          `[blobpipe] PUT "${ctx.key}" — ${result?.size !== undefined ? `${result.size} bytes` : 'size unknown'} ` +
            `in ${durationMs}ms` +
            (result?.etag ? ` (etag: ${result.etag})` : ''),
        );
      }
    } catch (err) {
      const durationMs = Date.now() - start;
      if (format === 'json') {
        logger.error(JSON.stringify({
          level: 'error',
          msg: 'blobpipe PUT failed',
          key: ctx.key,
          durationMs,
          error: err instanceof Error ? err.message : String(err),
        }));
      } else {
        logger.error(
          `[blobpipe] PUT "${ctx.key}" failed after ${durationMs}ms —`,
          err,
        );
      }
      throw err;
    }
  };
}
