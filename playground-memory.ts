import { Readable } from 'node:stream';
import { MemoryDriver } from '@restrella/blobpipe-memory';
import {
    StorageClient,
    RetryingDriver,
    logUploads,
    maxFileSize,
    validateMimeType,
    MiddlewareRejectionError,
} from '@restrella/blobpipe';

const memory = new MemoryDriver({ simulatedLatencyMs: 10 });
const client = new StorageClient(memory);

// ─── put ────────────────────────────────────────────────────────────────────

console.log('\n--- put: string ---');
console.log(await client.put('playground/string.txt', 'Hello from a plain string'));

console.log('\n--- put: Buffer ---');
console.log(await client.put('playground/buffer.txt', Buffer.from('Hello from a Buffer')));

console.log('\n--- put: Uint8Array ---');
console.log(await client.put('playground/uint8array.txt', new TextEncoder().encode('Hello from a Uint8Array')));

console.log('\n--- put: Readable stream ---');
console.log(await client.put('playground/stream.txt', Readable.from(['Hello ', 'from ', 'a ', 'stream'])));

console.log('\n--- put: with metadata ---');
console.log(await client.put('playground/with-metadata.txt', 'Has metadata', { metadata: { author: 'playground', env: 'dev' } }));

// ─── _dump: inspect raw store ────────────────────────────────────────────────

console.log('\n--- _dump (raw store snapshot) ---');
for (const [key, entry] of memory._dump()) {
    console.log(`  ${key} → ${entry.data.byteLength} bytes, uploaded ${entry.uploadedAt.toISOString()}`);
}

// ─── exists ─────────────────────────────────────────────────────────────────

console.log('\n--- exists: present key ---');
console.log(await client.exists('playground/string.txt'));

console.log('\n--- exists: missing key ---');
console.log(await client.exists('playground/does-not-exist.txt'));

// ─── stat ────────────────────────────────────────────────────────────────────

console.log('\n--- stat ---');
console.log(await client.stat('playground/with-metadata.txt'));

// ─── get ─────────────────────────────────────────────────────────────────────

console.log('\n--- get ---');
const stream = await client.get('playground/string.txt');
const chunks: Buffer[] = [];
for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
console.log(Buffer.concat(chunks).toString('utf8'));

// ─── getUrl ──────────────────────────────────────────────────────────────────

console.log('\n--- getUrl ---');
console.log(client.getUrl('playground/stream.txt'));

// ─── getSignedUrl ────────────────────────────────────────────────────────────

console.log('\n--- getSignedUrl: read ---');
console.log(await client.getSignedUrl('playground/stream.txt', { operation: 'read', expiresInSeconds: 600 }));

console.log('\n--- getSignedUrl: write ---');
console.log(await client.getSignedUrl('playground/buffer.txt', { operation: 'write', expiresInSeconds: 600 }));

// ─── list ────────────────────────────────────────────────────────────────────

console.log('\n--- list: all under playground/ ---');
for await (const obj of client.list({ prefix: 'playground/' })) {
    console.log(obj);
}

console.log('\n--- list: first 3 results ---');
for await (const obj of client.list({ prefix: 'playground/', limit: 3 })) {
    console.log(obj);
}

// ─── delete ──────────────────────────────────────────────────────────────────

console.log('\n--- delete: existing key ---');
await client.delete('playground/string.txt');
console.log('deleted playground/string.txt');

console.log('\n--- delete: missing key (should not throw) ---');
await client.delete('playground/does-not-exist.txt');
console.log('no error thrown');

// ─── _clear ──────────────────────────────────────────────────────────────────

console.log('\n--- _clear then list (should be empty) ---');
memory._clear();
const items: unknown[] = [];
for await (const obj of client.list()) items.push(obj);
console.log(`items after _clear: ${items.length}`);

// ─── middleware: logUploads ───────────────────────────────────────────────────

console.log('\n--- middleware: logUploads ---');
const loggedClient = new StorageClient(new MemoryDriver())
    .use(logUploads());
await loggedClient.put('demo/hello.txt', 'logged upload');

// ─── middleware: validateMimeType ─────────────────────────────────────────────

console.log('\n--- middleware: validateMimeType (allowed) ---');
const strictClient = new StorageClient(new MemoryDriver())
    .use(validateMimeType({ allowed: ['image/png', 'image/jpeg'] }));
console.log(await strictClient.put('demo/photo.png', 'fake png bytes', { contentType: 'image/png' }));

console.log('\n--- middleware: validateMimeType (rejected) ---');
try {
    await strictClient.put('demo/script.js', 'bad file', { contentType: 'application/javascript' });
} catch (err) {
    if (err instanceof MiddlewareRejectionError) {
        console.log(`Rejected (${err.code}): ${err.message}`);
    }
}

// ─── middleware: maxFileSize ──────────────────────────────────────────────────

console.log('\n--- middleware: maxFileSize (allowed) ---');
const sizedClient = new StorageClient(new MemoryDriver())
    .use(maxFileSize({ maxBytes: 100 }));
console.log(await sizedClient.put('demo/small.txt', 'tiny'));

console.log('\n--- middleware: maxFileSize (rejected — buffer) ---');
try {
    await sizedClient.put('demo/big.txt', 'x'.repeat(101));
} catch (err) {
    if (err instanceof MiddlewareRejectionError) {
        console.log(`Rejected (${err.code}): ${err.message}`);
    }
}

console.log('\n--- middleware: maxFileSize (rejected — stream) ---');
try {
    await sizedClient.put('demo/big-stream.txt', Readable.from(['x'.repeat(101)]));
} catch (err) {
    if (err instanceof MiddlewareRejectionError) {
        console.log(`Rejected (${err.code}): ${err.message}`);
    }
}

// ─── middleware: chained ─────────────────────────────────────────────────────

console.log('\n--- middleware: chained (validate + size + log) ---');
const chainedClient = new StorageClient(new MemoryDriver())
    .use(logUploads())
    .use(validateMimeType({ allowed: ['text/plain'] }))
    .use(maxFileSize({ maxBytes: 1024 }));
console.log(await chainedClient.put('demo/ok.txt', 'valid upload', { contentType: 'text/plain' }));

// ─── RetryingDriver ───────────────────────────────────────────────────────────

console.log('\n--- RetryingDriver ---');
const retrying = new RetryingDriver(new MemoryDriver(), { maxAttempts: 3, baseDelayMs: 10 });
const retryClient = new StorageClient(retrying);
console.log(`driver name: ${retrying.name}`);
console.log(await retryClient.put('demo/retry.txt', 'uploaded through retrying driver'));
console.log(await retryClient.get('demo/retry.txt').then(async (s) => {
    const bufs: Buffer[] = [];
    for await (const c of s) bufs.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(bufs).toString('utf8');
}));

console.log('\nDone.');
