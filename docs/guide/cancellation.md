# Cancellation

Every blobpipe operation accepts an optional `signal?: AbortSignal`. When the signal is aborted, the operation throws the abort reason immediately.

## Basic usage

```typescript
const controller = new AbortController()

// Cancel after 5 seconds
const timeout = setTimeout(() => controller.abort(new Error('Upload timed out')), 5000)

try {
  const result = await storage.put('large-file.zip', stream, {
    contentType: 'application/zip',
    signal: controller.signal,
  })
  clearTimeout(timeout)
} catch (err) {
  if (err instanceof Error && err.message === 'Upload timed out') {
    console.log('Upload was cancelled')
  }
}
```

## Express — cancel on client disconnect

```typescript
app.post('/upload', async (req, res) => {
  const controller = new AbortController()

  // Cancel the upload if the HTTP connection closes
  req.on('close', () => {
    if (!res.writableEnded) controller.abort(new Error('Client disconnected'))
  })

  try {
    const result = await storage.put(req.query.key as string, req, {
      contentType: req.headers['content-type'],
      signal: controller.signal,
    })
    res.json({ key: result.key, size: result.size })
  } catch (err) {
    if (!res.writableEnded) {
      res.status(500).json({ error: 'Upload failed' })
    }
  }
})
```

## Fastify — cancel on client disconnect

```typescript
app.post('/upload', async (request, reply) => {
  const controller = new AbortController()

  request.raw.on('close', () => {
    controller.abort(new Error('Client disconnected'))
  })

  const result = await storage.put('uploads/' + request.query.filename, request.raw, {
    contentType: request.headers['content-type'],
    signal: controller.signal,
  })

  return { key: result.key, size: result.size }
})
```

## Next.js API route

```typescript
// app/api/upload/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { storage } from '@/lib/storage'

export async function POST(request: NextRequest) {
  const body = await request.blob()
  const stream = body.stream()

  try {
    const result = await storage.put(
      `uploads/${crypto.randomUUID()}`,
      // Convert web ReadableStream to Node Readable
      require('stream').Readable.fromWeb(stream),
      {
        contentType: body.type,
        signal: request.signal, // Next.js provides AbortSignal on the request
      }
    )
    return NextResponse.json({ key: result.key })
  } catch (err) {
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
```

## Cancelling reads and lists

AbortSignal works on all operations:

```typescript
const controller = new AbortController()
setTimeout(() => controller.abort(), 10_000) // 10s read timeout

// get
const stream = await storage.get('large-file.zip', { signal: controller.signal })

// exists / stat
const exists = await storage.exists('file.txt', { signal: controller.signal })
const obj = await storage.stat('file.txt', { signal: controller.signal })

// delete
await storage.delete('file.txt', { signal: controller.signal })

// list
for await (const item of storage.list({ prefix: 'uploads/', signal: controller.signal })) {
  process(item)
}
```

## AbortSignal.timeout()

Node 17.3+ and all modern runtimes expose `AbortSignal.timeout(ms)` as a one-liner:

```typescript
const stream = await storage.get('file.jpg', {
  signal: AbortSignal.timeout(5000), // abort after 5s
})
```
