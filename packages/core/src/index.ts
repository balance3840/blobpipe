// Core abstractions
export { StorageClient } from './core/storage-client.js';
export { StorageDriverDecorator } from './core/storage-driver-decorator.js';
export type { StorageDriver, Disposable } from './core/storage-driver.js';
export type {
  UploadBody,
  ObjectMetadata,
  AccessLevel,
  PutOptions,
  PutResult,
  GetOptions,
  DeleteOptions,
  DeleteManyOptions,
  DeleteManyResult,
  ExistsOptions,
  StatOptions,
  StorageObject,
  ListOptions,
  ListPage,
  CopyOptions,
  MoveOptions,
  SignedUrlOperation,
  SignedUrlOptions,
} from './core/types.js';
export type {
  UploadContext,
  Middleware,
  MiddlewareFactory,
} from './core/middleware-types.js';
export { MiddlewareRejectionError } from './core/middleware-types.js';

// Errors
export {
  StorageError,
  ObjectNotFoundError,
  ObjectAlreadyExistsError,
  AccessDeniedError,
  InvalidKeyError,
  StorageOperationError,
  DriverConfigurationError,
} from './errors/storage-errors.js';

// Built-in middleware
export * from './middleware/index.js';

// Built-in decorators
export { RetryingDriver } from './utils/retrying-driver.js';
export type { RetryOptions } from './utils/retrying-driver.js';
export { InstrumentedDriver } from './utils/instrumented-driver.js';
export type { InstrumentedDriverOptions, OperationEvent } from './utils/instrumented-driver.js';

// Utilities
export { fromUrl } from './utils/from-url.js';
export type { FromUrlOptions, FromUrlResult } from './utils/from-url.js';
export { notImplemented } from './utils/not-implemented.js';
