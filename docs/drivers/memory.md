# Memory Driver

```bash
npm install @restrella/blobpipe @restrella/blobpipe-memory
```

An in-memory `StorageDriver` designed for unit tests. No network calls, no filesystem access, no external dependencies. Data lives in a `Map` and is gone when the process exits.

## Basic setup

```typescript
import { MemoryDriver } from '@restrella/blobpipe-memory'

const driver = new MemoryDriver()
```

## Configuration

```typescript
interface MemoryDriverConfig {
  simulatedLatencyMs?: number
}
```

| Option | Type | Description |
|---|---|---|
| `simulatedLatencyMs` | `number` | Artificial delay (ms) added to every operation. Useful for testing loading states and race conditions. |

## Test helpers

`MemoryDriver` has two methods that are intentionally not on the `StorageDriver` interface — they're test-only utilities:

### `_dump()`

Returns a snapshot of everything in the store:

```typescript
const driver = new MemoryDriver()
await driver.put('avatar.jpg', buffer, { contentType: 'image/jpeg' })

const store = driver._dump()
// Map { 'avatar.jpg' => { data: Buffer, contentType: 'image/jpeg', uploadedAt: Date } }

expect(store.get('avatar.jpg')?.contentType).toBe('image/jpeg')
```

### `_clear()`

Wipes all stored objects — use in `beforeEach` to reset state between tests:

```typescript
beforeEach(() => {
  driver._clear()
})
```

## Vitest example

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { StorageClient, ObjectNotFoundError } from '@restrella/blobpipe'
import { MemoryDriver } from '@restrella/blobpipe-memory'

// Use the same factory function your production code uses
function createStorage(driver = new MemoryDriver()) {
  return new StorageClient(driver)
    .use(logUploads())
    .use(validateMimeType({ allowed: ['image/png', 'image/jpeg'] }))
}

describe('file upload', () => {
  let driver: MemoryDriver
  let storage: StorageClient

  beforeEach(() => {
    driver = new MemoryDriver()
    storage = createStorage(driver)
  })

  it('stores a file and retrieves metadata', async () => {
    await storage.put('photo.jpg', Buffer.from('fake-jpeg'), {
      contentType: 'image/jpeg',
    })

    const obj = await storage.stat('photo.jpg')
    expect(obj.size).toBe(9)
    expect(obj.key).toBe('photo.jpg')
  })

  it('rejects disallowed MIME types', async () => {
    await expect(
      storage.put('script.exe', Buffer.from('MZ'), { contentType: 'application/octet-stream' })
    ).rejects.toThrow('DISALLOWED_CONTENT_TYPE')
  })

  it('throws ObjectNotFoundError for missing keys', async () => {
    await expect(storage.get('ghost.jpg')).rejects.toBeInstanceOf(ObjectNotFoundError)
  })

  it('asserts stored content via _dump()', async () => {
    const data = Buffer.from('hello')
    await storage.put('hello.txt', data, { contentType: 'text/plain' })

    const snapshot = driver._dump()
    expect(snapshot.get('hello.txt')?.data).toEqual(data)
  })
})
```

## Simulated latency

Add latency to expose timing-related bugs without flaky real I/O:

```typescript
const driver = new MemoryDriver({ simulatedLatencyMs: 100 })
const storage = new StorageClient(driver)

// Each operation takes ~100ms — good for testing loading states
await storage.put('file.txt', 'data', { contentType: 'text/plain' })
```

## Signed URL pseudo-URLs

`getSignedUrl()` returns a deterministic `memory://` pseudo-URL. Use it for assertions in tests:

```typescript
const url = await storage.getSignedUrl('photo.jpg', {
  operation: 'read',
  expiresInSeconds: 3600,
})
// => 'memory://photo.jpg?op=read&expires=1234567890000'
```
