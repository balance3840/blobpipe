# Contributing

Thank you for taking the time to contribute. All types of contributions are welcome — bug reports, feature requests, documentation improvements, and code.

## Reporting bugs

Open a [GitHub issue](https://github.com/balance3840/blobpipe/issues/new) and include:
- What you did
- What you expected to happen
- What actually happened
- Your Node.js version and which driver you're using

For security vulnerabilities, please follow the [Security Policy](SECURITY.md) instead of opening a public issue.

## Suggesting features

Open an issue describing the problem you're trying to solve — not just the solution. This helps with discussion before any code is written.

## Submitting a pull request

1. Fork the repository and create a branch from `main`
2. Set up locally:

```bash
pnpm install
```

3. Make your changes
4. Run the checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

5. Open a pull request with a clear description of what changed and why

Keep pull requests focused. One bug fix or one feature per PR is much easier to review than a large mixed change.

## Running tests

```bash
# Unit + contract tests — no credentials or Docker needed
pnpm test

# Watch mode during development
pnpm test --watch
```

Integration tests (against real cloud providers) and emulator tests (against local Docker containers) run automatically in CI.

## Project layout

```
packages/
  core/          # StorageClient, middleware, errors, shared types
  s3/            # S3Driver
  gcs/           # GcsDriver
  azure-blob/    # AzureBlobDriver
  local/         # LocalDriver
  memory/        # MemoryDriver — in-process, for tests
tests/
  unit/          # Pure unit tests, no I/O
  contract/      # Shared behavioural suite run against each driver
  helpers/       # Shared test utilities
```

---

## Code style

The project uses TypeScript strict mode with several additional flags. Understanding them upfront will save you time.

### TypeScript compiler flags

The project enables several strict flags beyond `strict: true`. Here's how they affect day-to-day code:

| Flag | Consequence |
|---|---|
| `exactOptionalPropertyTypes` | `foo?: string` and `foo?: string \| undefined` are distinct — use the spread pattern for optional fields |
| `noUncheckedIndexedAccess` | `arr[i]` is `T \| undefined`, not `T` — check or assert |
| `noUnusedLocals` / `noUnusedParameters` | Prefix intentionally unused params with `_` |
| `noImplicitOverride` | Methods that override a parent must use the `override` keyword |

**Spread pattern for optional fields** (`exactOptionalPropertyTypes`):

```typescript
// ✗
return { body: stream, contentType: rawType ?? undefined };

// ✓
return {
  body: stream,
  ...(rawType !== undefined && { contentType: rawType }),
};
```

**Unused parameters:**

```typescript
// ✓
new Transform({ transform(chunk: Buffer, _enc, cb) { ... } });
```

---

### Imports

Always use `.js` extensions on local imports (required for ESM):

```typescript
import { StorageError } from '../errors/storage-errors.js';
import type { PutOptions } from './types.js';
```

Group imports in this order, separated by a blank line:

```typescript
// 1. Node built-ins (always with the node: prefix)
import { createHash } from 'node:crypto';
import { Readable }   from 'node:stream';

// 2. External packages
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// 3. Internal packages
import type { StorageDriver } from '@restrella/blobpipe';

// 4. Relative imports
import type { S3DriverConfig } from './types.js';
import { wrapS3Error }         from './errors.js';
```

Use `import type` for anything that only appears in type position — it's erased at compile time and signals intent:

```typescript
// ✓ — all types in one import, all values in another
import type { PutOptions, PutResult } from './types.js';
import { StorageOperationError }      from './errors.js';

// ✓ — when you need types and values from the same module, use the inline `type` keyword
import { type Middleware, type UploadContext, MiddlewareRejectionError } from './middleware-types.js';

// ✗ — importing types without any type annotation
import { PutOptions, StorageOperationError } from './errors.js';
```

---

### Types vs interfaces

Use **`interface`** for object shapes that describe data or contracts:

```typescript
export interface PutOptions {
  contentType?: string;
  metadata?: ObjectMetadata;
  signal?: AbortSignal;
}

export interface StorageDriver {
  readonly name: string;
  put(key: string, data: UploadBody, opts?: PutOptions): Promise<PutResult>;
  // ...
}
```

Use **`type`** for function signatures, unions, intersections, and aliases:

```typescript
export type UploadBody = Buffer | Uint8Array | Readable | string;

export type Middleware = (ctx: UploadContext, next: () => Promise<void>) => Promise<void>;

export type MiddlewareFactory<TOptions> = (options: TOptions) => Middleware;
```

No enums — use string literal unions instead:

```typescript
// ✗
enum AccessLevel { Private = 'private', PublicRead = 'public-read' }

// ✓
export type AccessLevel = 'private' | 'public-read';
```

---

### Exports

No default exports. Named exports only, everywhere:

```typescript
// ✗
export default class S3Driver { ... }

// ✓
export class S3Driver { ... }
```

Each package has a single barrel index (`src/index.ts`) that explicitly lists its public API. Don't re-export things that are internal implementation detail.

---

### File and identifier naming

- **Files:** `kebab-case.ts` — `s3-driver.ts`, `validate-mime-type.ts`, `storage-errors.ts`
- **Classes:** `PascalCase` — `S3Driver`, `StorageClient`, `ObjectNotFoundError`
- **Functions and variables:** `camelCase` — `validateMimeType`, `fromUrl`, `makeDriver`
- **Types and interfaces:** `PascalCase` — `PutOptions`, `StorageObject`, `Middleware`
- **Constants:** `camelCase` (not `SCREAMING_SNAKE_CASE`)

---

### Classes

Use parameter properties for injected dependencies:

```typescript
// ✓ — concise, idiomatic TypeScript
export class S3Driver implements StorageDriver {
  readonly name = 's3';

  constructor(private readonly config: S3DriverConfig) {}
}
```

Mark fields `readonly` whenever they don't change after construction. Mark the driver `name` as a literal:

```typescript
readonly name = 'local' as const;
```

---

### Error handling

Every error thrown by a driver must extend `StorageError`. Always wrap provider SDK errors with `{ cause: err }`:

```typescript
// ✓
try {
  await this.client.send(new GetObjectCommand({ ... }));
} catch (err) {
  if (isS3NotFound(err)) throw new ObjectNotFoundError(key, this.name, { cause: err });
  throw new StorageOperationError(`Failed to get "${key}"`, this.name, { cause: err });
}
```

Use small, focused guard functions at module scope for error classification:

```typescript
function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
```

Never let SDK-specific error types escape into user-facing catch blocks. If a caller has to `import { NoSuchKey } from '@aws-sdk/client-s3'` to handle an error from this library, something is wrong.

---

### Non-null assertions

Use `!` only when TypeScript cannot narrow the type but you have a guarantee from the surrounding logic. Always add a comment explaining why the assertion is safe:

```typescript
// ✓ — safe: i < middlewares.length is checked before this call
return this.middlewares[i]!(ctx, () => dispatch(i + 1));

// ✓ — safe: split() always returns at least one element
const mime = contentType.split(';')[0]!.trim();

// ✗ — assertion without explanation
const value = map.get(key)!;
```

---

### Comments

Write comments only when the **why** is non-obvious. The code should explain the **what**.

```typescript
// ✗ — describes what the code does (already obvious)
// Increment the counter
count++;

// ✓ — explains a non-obvious constraint or decision
// S3 requires forcePathStyle for Localstack but not for real AWS — detect by endpoint
const forcePathStyle = config.endpoint !== undefined && config.forcePathStyle !== false;
```

Use JSDoc for exported types, classes, and functions — keep it short:

```typescript
/**
 * Rejects uploads whose contentType is not in the allowed list.
 * Validates the declared type only — pair with sniffMimeType if you
 * need protection against spoofed content-type headers.
 */
export const validateMimeType: MiddlewareFactory<ValidateMimeTypeOptions> = (options) => { ... };
```

Don't document parameter types in JSDoc — TypeScript already does that.

---

### Async style

Prefer `async/await` over `.then()` chains. The exception is tight dispatch loops where the extra stack frame matters:

```typescript
// ✓ — straightforward async/await
async put(key: string, data: UploadBody, opts?: PutOptions): Promise<PutResult> {
  opts?.signal?.throwIfAborted();
  const result = await this.client.send(new PutObjectCommand({ ... }));
  return { key, size: result.$metadata.httpStatusCode, uploadedAt: new Date() };
}
```

Always call `opts?.signal?.throwIfAborted()` at the top of every public driver method — before any I/O — so cancellation is checked immediately.

---

### Linting

The project uses `typescript-eslint` with the recommended ruleset. Run before committing:

```bash
pnpm lint
```

Key rules in effect:
- Unused variables and parameters are errors (prefix with `_` to suppress intentionally)
- `@typescript-eslint/recommended` — covers no-explicit-any, consistent-type-imports, and more

If you need to suppress a lint rule on a specific line, add a comment explaining why:

```typescript
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- safe: checked above
```

---

### Formatting

- **Quotes:** single quotes everywhere — `'text/plain'`, not `"text/plain"`
- **Semicolons:** always — no ASI reliance
- **Indentation:** 2 spaces
- **Trailing commas:** on multi-line parameter lists and arrays

These are enforced by the editor config. If you use VS Code, install the ESLint extension and it will flag deviations automatically.
