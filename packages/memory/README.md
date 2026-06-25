# @blobpipe/memory

In-memory storage driver for blobpipe — no network calls, no filesystem access, ideal for unit tests.

## Installation

```bash
npm install @blobpipe/memory
```

## Usage

```typescript
import { StorageClient } from '@blobpipe/core';
import { MemoryDriver } from '@blobpipe/memory';

const client = new StorageClient(new MemoryDriver());

await client.put('file.txt', 'Hello, world!');
const stream = await client.get('file.txt');
const exists = await client.exists('file.txt');
await client.delete('file.txt');
```

### Test helpers

The `MemoryDriver` exposes two test-only methods:

```typescript
const driver = new MemoryDriver();
driver._dump(); // snapshot of all stored objects
driver._clear(); // wipe all stored objects
```

### Simulated latency

```typescript
const driver = new MemoryDriver({ simulatedLatencyMs: 50 });
```

## Notes

- Data does not persist across process restarts
- Each `new MemoryDriver()` starts empty; instances are not shared
- `move()` is atomic (in-memory Map operation)

## Requirements

Node.js >= 18.17
