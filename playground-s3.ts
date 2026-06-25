import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { S3Driver } from '@blobpipe/s3';
import {
    StorageClient,
    RetryingDriver,
    logUploads,
    maxFileSize,
    validateMimeType,
    MiddlewareRejectionError,
    fromUrl,
} from '@blobpipe/core';

// ─── S3 / MinIO setup ────────────────────────────────────────────────────────
// Default config targets MinIO running locally via Docker:
//   docker run -p 9000:9000 -p 9001:9001 \
//     -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
//     quay.io/minio/minio server /data --console-address ":9001"
// Then create a bucket named "playground" in the MinIO console at http://localhost:9001.
//
// To target real AWS instead, remove `endpoint` and `forcePathStyle`:
//   new S3Driver({ bucket: 'my-bucket', region: 'us-east-1', credentials: { ... } })
//
// To target LocalStack:
//   new S3Driver({ bucket: 'playground', region: 'us-east-1',
//     endpoint: 'http://localhost:4566', forcePathStyle: true,
//     credentials: { accessKeyId: 'test', secretAccessKey: 'test' } })

const s3 = new S3Driver({
    bucket: 'playground',
    region: 'us-east-1',
    endpoint: 'http://127.0.0.1:9000',
    forcePathStyle: true,
    credentials: {
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
    },
});

const client = new StorageClient(s3);

// ─── put ────────────────────────────────────────────────────────────────────

console.log('\n--- put: string ---');
console.log(await client.put('playground/string.txt', 'Hello from a plain string'));

console.log('\n--- put: Buffer ---');
console.log(await client.put('playground/buffer.txt', Buffer.from('Hello from a Buffer')));

console.log('\n--- put: Uint8Array ---');
console.log(await client.put('playground/uint8array.txt', new TextEncoder().encode('Hello from a Uint8Array')));

console.log('\n--- put: Readable stream ---');
console.log(await client.put('playground/stream.txt', Readable.from(['Hello ', 'from ', 'a ', 'stream'])));

console.log('\n--- put: local file ---');
console.log(await client.put('playground/package.json', createReadStream('./package.json'), { contentType: 'application/json' }));

console.log('\n--- put: file from URL ---');
const { body: remoteBody, contentType: remoteContentType } = await fromUrl('https://gist.githubusercontent.com/YusufCagan-Python/318a6484df31fab12f2d868054cbe0b3/raw/04f6597ddcc0ce97979a2073b1936cb323f226a0/str.py');
console.log(await client.put('playground/cities.json', remoteBody, { contentType: remoteContentType }));

console.log('\n--- put: with metadata ---');
console.log(await client.put('playground/with-metadata.txt', 'Has metadata', { metadata: { author: 'playground', env: 'dev' } }));

console.log('\n--- put: with AbortSignal ---');
console.log(await client.put('playground/with-signal.txt', 'Uploaded with an AbortSignal', { signal: new AbortController().signal }));

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

console.log('\n--- getSignedUrl: read (10 min) ---');
const readUrl = await client.getSignedUrl('playground/stream.txt', { operation: 'read', expiresInSeconds: 600 });
console.log(readUrl);

console.log('\n--- getSignedUrl: write (10 min) ---');
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

// ─── middleware: logUploads ───────────────────────────────────────────────────

console.log('\n--- middleware: logUploads ---');
const loggedClient = new StorageClient(s3).use(logUploads());
await loggedClient.put('playground/logged.txt', 'upload tracked by logUploads middleware');

// ─── middleware: validateMimeType ─────────────────────────────────────────────

console.log('\n--- middleware: validateMimeType (allowed) ---');
const strictClient = new StorageClient(s3)
    .use(validateMimeType({ allowed: ['image/png', 'image/jpeg', 'text/plain'] }));
console.log(await strictClient.put('playground/valid.txt', 'I am a text file', { contentType: 'text/plain' }));

console.log('\n--- middleware: validateMimeType (rejected) ---');
try {
    await strictClient.put('playground/bad.exe', 'not allowed', { contentType: 'application/octet-stream' });
} catch (err) {
    if (err instanceof MiddlewareRejectionError) {
        console.log(`Rejected (${err.code}): ${err.message}`);
    }
}

// ─── middleware: maxFileSize ──────────────────────────────────────────────────

console.log('\n--- middleware: maxFileSize (allowed) ---');
const sizedClient = new StorageClient(s3).use(maxFileSize({ maxBytes: 1024 }));
console.log(await sizedClient.put('playground/small.txt', 'well within the limit'));

console.log('\n--- middleware: maxFileSize (rejected — Buffer) ---');
try {
    await sizedClient.put('playground/big.txt', 'x'.repeat(1025));
} catch (err) {
    if (err instanceof MiddlewareRejectionError) {
        console.log(`Rejected (${err.code}): ${err.message}`);
    }
}

console.log('\n--- middleware: maxFileSize (rejected — Readable stream) ---');
try {
    await sizedClient.put('playground/big-stream.txt', Readable.from(['x'.repeat(1025)]));
} catch (err) {
    if (err instanceof MiddlewareRejectionError) {
        console.log(`Rejected (${err.code}): ${err.message}`);
    }
}

// ─── middleware: chained ─────────────────────────────────────────────────────

console.log('\n--- middleware: chained (log + validate + size) ---');
const chainedClient = new StorageClient(s3)
    .use(logUploads())
    .use(validateMimeType({ allowed: ['text/plain'] }))
    .use(maxFileSize({ maxBytes: 512 }));
console.log(await chainedClient.put('playground/chained.txt', 'passes all three checks', { contentType: 'text/plain' }));

// ─── RetryingDriver ───────────────────────────────────────────────────────────

console.log('\n--- RetryingDriver ---');
const retrying = new RetryingDriver(s3, { maxAttempts: 3, baseDelayMs: 200 });
const retryClient = new StorageClient(retrying);
console.log(`driver name: ${retrying.name}`);
console.log(await retryClient.put('playground/retry.txt', 'uploaded through the retrying driver'));
console.log(await retryClient.stat('playground/retry.txt'));

console.log('\nDone.');
