# Testing

`MemoryDriver` is the primary testing tool — it implements the full `StorageDriver` interface in memory, so you can replace any real driver without mocking.

## Factory function pattern

The key is a factory function that accepts any `StorageDriver`. Production code passes a real driver; tests pass `MemoryDriver`:

```typescript
// src/storage.ts
import { StorageClient, type StorageDriver, logUploads, validateMimeType, maxFileSize } from '@restrella/blobpipe'

export function createStorageClient(driver: StorageDriver): StorageClient {
  return new StorageClient(driver)
    .use(logUploads({ format: 'json' }))
    .use(validateMimeType({ allowed: ['image/png', 'image/jpeg', 'image/webp'] }))
    .use(maxFileSize({ maxBytes: 10 * 1024 * 1024 }))
}
```

```typescript
// Production
import { S3Driver } from '@restrella/blobpipe-s3'
export const storage = createStorageClient(new S3Driver({ bucket: 'prod', region: 'us-east-1' }))
```

```typescript
// Tests
import { MemoryDriver } from '@restrella/blobpipe-memory'
const driver = new MemoryDriver()
const storage = createStorageClient(driver)
```

## Vitest

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { StorageClient, ObjectNotFoundError, MiddlewareRejectionError } from '@restrella/blobpipe'
import { MemoryDriver } from '@restrella/blobpipe-memory'
import { createStorageClient } from '../src/storage'

describe('StorageClient', () => {
  let driver: MemoryDriver
  let storage: StorageClient

  beforeEach(() => {
    driver = new MemoryDriver()
    storage = createStorageClient(driver)
  })

  it('stores and retrieves a file', async () => {
    const content = Buffer.from('hello world')
    await storage.put('test.txt', content, { contentType: 'text/plain' })

    const stream = await storage.get('test.txt')
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer)
    }
    expect(Buffer.concat(chunks).toString()).toBe('hello world')
  })

  it('returns file metadata', async () => {
    await storage.put('photo.jpg', Buffer.from('fake-jpeg-bytes'), {
      contentType: 'image/jpeg',
      metadata: { alt: 'A photo' },
    })

    const obj = await storage.stat('photo.jpg')
    expect(obj.key).toBe('photo.jpg')
    expect(obj.size).toBe(15)
    expect(obj.metadata?.alt).toBe('A photo')
  })

  it('throws ObjectNotFoundError for missing keys', async () => {
    await expect(storage.get('ghost.jpg')).rejects.toBeInstanceOf(ObjectNotFoundError)
    await expect(storage.stat('ghost.jpg')).rejects.toBeInstanceOf(ObjectNotFoundError)
  })

  it('rejects disallowed MIME types', async () => {
    await expect(
      storage.put('script.exe', Buffer.from('MZ'), { contentType: 'application/octet-stream' })
    ).rejects.toThrow(MiddlewareRejectionError)
  })

  it('lists all stored files', async () => {
    await storage.put('a/1.jpg', Buffer.from('a'), { contentType: 'image/jpeg' })
    await storage.put('a/2.jpg', Buffer.from('b'), { contentType: 'image/jpeg' })
    await storage.put('b/3.jpg', Buffer.from('c'), { contentType: 'image/jpeg' })

    const items: string[] = []
    for await (const obj of storage.list({ prefix: 'a/' })) {
      items.push(obj.key)
    }
    expect(items).toEqual(['a/1.jpg', 'a/2.jpg'])
  })

  it('asserts stored content via _dump()', async () => {
    const data = Buffer.from('test content')
    await storage.put('doc.txt', data, {
      contentType: 'text/plain',
      metadata: { source: 'test' },
    })

    const snapshot = driver._dump()
    expect(snapshot.size).toBe(1)
    expect(snapshot.get('doc.txt')?.data).toEqual(data)
    expect(snapshot.get('doc.txt')?.contentType).toBe('text/plain')
    expect(snapshot.get('doc.txt')?.metadata?.source).toBe('test')
  })

  it('deletes a file', async () => {
    await storage.put('temp.jpg', Buffer.from('x'), { contentType: 'image/jpeg' })
    expect(await storage.exists('temp.jpg')).toBe(true)
    await storage.delete('temp.jpg')
    expect(await storage.exists('temp.jpg')).toBe(false)
  })
})
```

## Jest

```typescript
import { StorageClient, ObjectNotFoundError } from '@restrella/blobpipe'
import { MemoryDriver } from '@restrella/blobpipe-memory'
import { createStorageClient } from '../src/storage'

describe('StorageClient', () => {
  let driver: MemoryDriver
  let storage: StorageClient

  beforeEach(() => {
    driver = new MemoryDriver()
    storage = createStorageClient(driver)
  })

  it('stores a file', async () => {
    const result = await storage.put('hello.txt', 'Hello!', { contentType: 'text/plain' })
    expect(result.key).toBe('hello.txt')
    expect(result.size).toBe(6)
  })

  it('throws on missing key', async () => {
    await expect(storage.get('missing.txt')).rejects.toThrow(ObjectNotFoundError)
  })
})
```

## Simulated latency

Test loading states and race conditions without real I/O:

```typescript
const driver = new MemoryDriver({ simulatedLatencyMs: 100 })
const storage = createStorageClient(driver)

// Each operation now takes ~100ms — expose timing bugs in your UI
```

## AbortSignal in tests

```typescript
it('respects AbortSignal', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))

  await expect(
    storage.put('file.jpg', Buffer.from('x'), {
      contentType: 'image/jpeg',
      signal: controller.signal,
    })
  ).rejects.toThrow('cancelled')
})
```

## Resetting between tests

Use `_clear()` in `beforeEach` to reset state:

```typescript
beforeEach(() => {
  driver._clear()
})
```

Or create a fresh `MemoryDriver` for each test (shown above) — either pattern works.
