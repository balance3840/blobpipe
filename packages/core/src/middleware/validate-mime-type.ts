import { MiddlewareRejectionError, type MiddlewareFactory } from '../core/middleware-types.js';

export interface ValidateMimeTypeOptions {
  /** Allowed MIME types, e.g. ['image/png', 'image/jpeg']. */
  allowed: string[];
}

/**
 * Rejects uploads whose `options.contentType` is not in the allowed list.
 *
 * Validates the *declared* content type (`ctx.options.contentType`) only —
 * it does not sniff file content or magic bytes. Pair with a content-sniffing
 * middleware if you need to guard against spoofed content-type headers.
 *
 * Parameters (e.g. `image/png; charset=utf-8`) are stripped before matching.
 */
export const validateMimeType: MiddlewareFactory<ValidateMimeTypeOptions> = (options) => {
  const allowed = options.allowed.map((t) => t.split(';')[0]!.trim().toLowerCase());

  return async (ctx, next) => {
    const contentType = ctx.options.contentType;

    if (!contentType) {
      throw new MiddlewareRejectionError(
        `Upload for "${ctx.key}" was rejected: contentType is required but was not provided.`,
        'MISSING_CONTENT_TYPE',
      );
    }

    const normalized = contentType.split(';')[0]!.trim().toLowerCase();
    if (!allowed.includes(normalized)) {
      throw new MiddlewareRejectionError(
        `Upload for "${ctx.key}" was rejected: content type "${contentType}" is not allowed. ` +
          `Allowed: ${options.allowed.join(', ')}.`,
        'DISALLOWED_CONTENT_TYPE',
      );
    }

    await next();
  };
};
