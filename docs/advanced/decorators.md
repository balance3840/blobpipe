# Decorators

Decorators wrap a `StorageDriver` and intercept all operations (not just `put()`). They're for infrastructure concerns: retries, metrics, and tracing. Both are exported from `@blobpipe/core`.

## RetryingDriver

Wraps any driver with exponential backoff and jitter. Automatically retries transient failures on all operations.

```typescript
import { StorageClient, RetryingDriver } from '@blobpipe/core'
import { S3Driver } from '@blobpipe/s3'

const storage = new StorageClient(
  new RetryingDriver(new S3Driver({ bucket: 'my-bucket', region: 'us-east-1' }), {
    maxAttempts: 5,
    baseDelayMs: 200,
  })
)
```

### Configuration

```typescript
interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  shouldRetry?: (error: unknown) => boolean
}
```

| Option | Type | Default | Description |
|---|---|---|---|
| `maxAttempts` | `number` | `3` | Maximum number of attempts, including the first |
| `baseDelayMs` | `number` | `200` | Base delay in ms for exponential backoff |
| `shouldRetry` | `(error) => boolean` | see below | Predicate controlling whether to retry a given error |

**Default `shouldRetry` behavior:**

Never retries these errors (they won't resolve on retry):
- `ObjectNotFoundError` — the key doesn't exist
- `AccessDeniedError` — missing permissions
- `InvalidKeyError` — key is malformed

Retries everything else (network errors, timeouts, `StorageOperationError`, etc.).

### Backoff formula

```
delay = baseDelayMs * 2^(attempt - 1) + jitter
jitter = random(0, delay * 0.25)  // up to 25% of base to avoid thundering herd
```

For `baseDelayMs: 200` and `maxAttempts: 3`:
- Attempt 1: immediate
- Attempt 2: ~200ms
- Attempt 3: ~400ms

### Custom shouldRetry

```typescript
import { StorageOperationError } from '@blobpipe/core'

new RetryingDriver(driver, {
  maxAttempts: 4,
  shouldRetry: (err) => {
    // Only retry explicit storage operation errors (network, timeout)
    return err instanceof StorageOperationError
  },
})
```

### What gets retried

`RetryingDriver` retries: `put`, `get`, `delete`, `exists`, `stat`, `copy`, `move`, `listPage`, `deleteMany`.

It does **not** retry:
- `list` — async iterators can't be safely rewound mid-page after a failure
- `getSignedUrl` — pure computation in most drivers, no I/O to retry

---

## InstrumentedDriver

Wraps any driver and emits an `OperationEvent` after every operation (success or failure). Wire it to your metrics system, OpenTelemetry, or a logger.

```typescript
import { StorageClient, InstrumentedDriver } from '@blobpipe/core'
import { S3Driver } from '@blobpipe/s3'

const storage = new StorageClient(
  new InstrumentedDriver(new S3Driver({ bucket: 'my-bucket', region: 'us-east-1' }), {
    onOperation: ({ driver, operation, key, durationMs, error }) => {
      console.log(`[${driver}] ${operation} "${key}" — ${durationMs}ms${error ? ' ERROR' : ''}`)
    },
  })
)
```

### Configuration

```typescript
interface InstrumentedDriverOptions {
  onOperation: (event: OperationEvent) => void
}

interface OperationEvent {
  driver: string      // driver name, e.g. "s3"
  operation: string   // "put" | "get" | "delete" | "exists" | "stat" | "copy" | "move" | "list" | "listPage" | "deleteMany"
  key: string         // primary key (source key for copy/move, first key for deleteMany, prefix for list)
  durationMs: number  // wall-clock duration in ms
  error?: unknown     // set when the operation threw; undefined on success
}
```

### Wire to a metrics system

```typescript
// Datadog / StatsD
new InstrumentedDriver(driver, {
  onOperation: ({ operation, durationMs, error }) => {
    metrics.histogram('storage.operation.duration', durationMs, [
      `operation:${operation}`,
      `status:${error ? 'error' : 'ok'}`,
    ])
  },
})

// OpenTelemetry
import { trace, SpanStatusCode } from '@opentelemetry/api'

const tracer = trace.getTracer('blobpipe')

new InstrumentedDriver(driver, {
  onOperation: ({ driver, operation, key, durationMs, error }) => {
    const span = tracer.startSpan(`storage.${operation}`)
    span.setAttributes({ 'storage.driver': driver, 'storage.key': key })
    if (error) span.setStatus({ code: SpanStatusCode.ERROR })
    span.end()
  },
})
```

## Composing decorators

Decorators stack — wrap them in any order:

```typescript
import { StorageClient, RetryingDriver, InstrumentedDriver } from '@blobpipe/core'
import { S3Driver } from '@blobpipe/s3'

const base = new S3Driver({ bucket: 'my-bucket', region: 'us-east-1' })

// Instrument first (outermost), so timing includes retry delays
const storage = new StorageClient(
  new InstrumentedDriver(
    new RetryingDriver(base, { maxAttempts: 3 }),
    {
      onOperation: ({ operation, durationMs, error }) =>
        metrics.histogram('storage.op', durationMs, { operation, ok: !error }),
    }
  )
)
```

The decorator name is composited automatically:
```typescript
storage.getDriver().name  // "instrumented(retrying(s3))"
```
