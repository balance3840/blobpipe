import type { ObjectMetadata, PutOptions, PutResult, UploadBody } from './types.js';

/**
 * Mutable context object threaded through the middleware chain for a single
 * put() call. Middlewares read from and write to this object, then call
 * `next()` to continue the chain (Chain of Responsibility pattern).
 *
 * Design notes:
 * - `body` and `options` are mutable on purpose: a resize-image middleware
 *   needs to replace `body` with the resized bytes before the next
 *   middleware (or the driver) sees it.
 * - `result` is populated only after the underlying driver.put() has run,
 *   so "post" logic (e.g. logging, webhook firing) can read it on the way
 *   back out of the chain.
 * - `locals` is an escape hatch for middlewares to pass arbitrary data to
 *   later middlewares in the same chain without widening this interface.
 */
export interface UploadContext {
  /** The key the object will be / was stored under. */
  key: string;
  /** The payload being uploaded. Middlewares may replace this. */
  body: UploadBody;
  /** Options for the put() call. Middlewares may mutate this. */
  options: PutOptions;
  /** Populated after the driver has handled the request. Undefined during "pre" phase. */
  result?: PutResult;
  /** Free-form bag for middleware-to-middleware data passing within one chain run. */
  locals: Record<string, unknown>;
}

/**
 * A single middleware step. Call `next()` to continue down the chain;
 * omitting the call short-circuits the pipeline (e.g. validation rejection).
 */
export type Middleware = (ctx: UploadContext, next: () => Promise<void>) => Promise<void>;

/**
 * Helper type for middlewares that need configuration, e.g.:
 *   const maxFileSize: MiddlewareFactory<{ maxBytes: number }> = (opts) => async (ctx, next) => {...}
 */
export type MiddlewareFactory<TOptions> = (options: TOptions) => Middleware;

/**
 * Thrown by middlewares to halt the pipeline with a specific reason
 * (e.g. file too large, disallowed mime type). Distinct from driver-level
 * errors so callers can tell "your input was rejected" apart from
 * "the storage backend failed".
 */
export class MiddlewareRejectionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly metadata?: ObjectMetadata,
  ) {
    super(message);
    this.name = 'MiddlewareRejectionError';
  }
}
