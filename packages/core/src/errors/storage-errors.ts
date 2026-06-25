/**
 * Base class for all errors this library throws.
 *
 * Drivers are responsible for catching provider-SDK-specific errors
 * (e.g. AWS's `NoSuchKey`, Azure's `BlobNotFound`) and re-throwing the
 * appropriate subclass below, so callers can write provider-agnostic
 * error handling instead of importing each provider's SDK error types.
 */
export abstract class StorageError extends Error {
  /** The driver name that raised this error, e.g. "s3", "azure-blob". */
  abstract readonly driver: string;
  /** The original, provider-specific error, if this wraps one. Useful for debugging/logging. */
  override readonly cause?: unknown;

  protected constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    this.cause = options?.cause;
  }
}

export class ObjectNotFoundError extends StorageError {
  readonly driver: string;
  constructor(
    public readonly key: string,
    driver: string,
    options?: { cause?: unknown },
  ) {
    super(`Object not found: "${key}"`, options);
    this.driver = driver;
  }
}

export class AccessDeniedError extends StorageError {
  readonly driver: string;
  constructor(
    public readonly key: string,
    driver: string,
    options?: { cause?: unknown },
  ) {
    super(`Access denied for object: "${key}"`, options);
    this.driver = driver;
  }
}

export class InvalidKeyError extends StorageError {
  readonly driver: string;
  constructor(
    public readonly key: string,
    reason: string,
    driver: string,
    options?: { cause?: unknown },
  ) {
    super(`Invalid key "${key}": ${reason}`, options);
    this.driver = driver;
  }
}

/** Thrown when a driver operation fails for reasons outside the categories above (network, timeout, malformed response, etc.). */
export class StorageOperationError extends StorageError {
  readonly driver: string;
  constructor(
    message: string,
    driver: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.driver = driver;
  }
}

/** Thrown when a driver is misconfigured (missing credentials, invalid bucket name, etc.) — fails fast at construction time. */
export class DriverConfigurationError extends StorageError {
  readonly driver: string;
  constructor(
    message: string,
    driver: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.driver = driver;
  }
}

/** Thrown when `put()` is called with `ifNoneMatch: '*'` and the key already exists. */
export class ObjectAlreadyExistsError extends StorageError {
  readonly driver: string;
  readonly code = 'OBJECT_ALREADY_EXISTS';
  constructor(key: string, driver: string, opts?: { cause?: unknown }) {
    super(`Object "${key}" already exists in driver "${driver}"`, opts);
    this.name = 'ObjectAlreadyExistsError';
    this.driver = driver;
  }
}
