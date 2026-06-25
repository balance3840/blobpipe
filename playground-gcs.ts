import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { GcsDriver } from '@blobpipe/gcs';
import { StorageClient, RetryingDriver, logUploads, maxFileSize, validateMimeType, MiddlewareRejectionError, fromUrl } from '@blobpipe/core';

// ─── GCS / Fake GCS Server setup ─────────────────────────────────────────────
//
// Default config targets Fake GCS Server running locally via Docker:
//   docker run -p 4443:4443 fsouza/fake-gcs-server \
//     -scheme http -public-host localhost:4443
//
// Then create a bucket named "playground" before running:
//   curl -X POST http://localhost:4443/storage/v1/b \
//     -H 'Content-Type: application/json' \
//     -d '{"name":"playground"}'
//
// To target real GCS instead, swap the auth block:
//   auth: { mode: 'adc', projectId: 'my-project' }
//   auth: { mode: 'key-file', projectId: 'my-project', keyFilename: '/path/to/key.json' }
//   auth: { mode: 'credentials', projectId: 'my-project', clientEmail: '...', privateKey: '...' }
// and remove apiEndpoint.
//
// Note: getSignedUrl() requires a service account with a private key (key-file
// or credentials mode). ADC via gcloud user credentials cannot sign URLs.

const gcs = new GcsDriver({
    bucket: 'playground',
    auth: {
        mode: 'credentials',
        projectId: 'fake-project',
        clientEmail: 'fake@fake.iam.gserviceaccount.com',
        // Fake GCS Server doesn't validate signatures, so this dummy key works.
        privateKey: [
            '-----BEGIN RSA PRIVATE KEY-----',
            'MIIEowIBAAKCAQEA2a2rwplBQLF29amygykEMmYz0+Kcj3bKBp29Gq3sCFTGjq9',
            '5cDoN7ULx1I3ZJmHME5RGE6XqNEDR7EQO9g2LqLr0FKDEJkqbzAb5g8VxvTQ1f',
            'uA0zVP3kMIRlI+BmW26PQE8Zg3VapnUFjFSzDgjkJoIuoAqaJZ/rKBhS4pMCNMj',
            'b7fADOp4ApxkGLpjBEo7j4pPvulKvMCrV3dOaGYuPjFZZNt0eALXTa0LBQX6iFC',
            'T+9fmXbLbVMSJ/0ojKTqDOzKFh8BIQK7FXJfhEJkdDTzBiO+mdZtLlpjYlNqeG',
            '9mPzJMDhJJwBP3Z5J5N9L5X8yE/QxGb0+pGqEwIDAQABAoIBAHwN58kMKpUz1yDh',
            'LBuHE2JMNhkTy2JTQ9MkbF3MNT9YqFRfNvVqJSaLwRxmjvqxB5WQXQ5QhZqK7p',
            'A7o5RtV7k3V8tEJuGvJbx7JZAg3mI5hqC6sMRQx5oX3sJ9Uu+NQaQ7J6cVx4/Y',
            'q5yTRZ1kK+Q4U9Q8VeXh0e6H5PF1KZJ1UdRo7H2NKI2pKxM7gVQ8Qf3hRB5yX0',
            'pGQZmR7vAoGBAO8VT+9fmXbLbVMSJ/0ojKTqDOzKFh8BIQK7FXJfhEJkdDTzBiO',
            '+mdZtLlpjYlNqeG9mPzJMDhJJwBP3Z5J5N9L5X8yE/QxGb0+pGqEwIDAQABTG0',
            '-----END RSA PRIVATE KEY-----',
        ].join('\n'),
    },
    apiEndpoint: 'http://localhost:4443',
});

const client = new StorageClient(gcs);

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
console.log(await client.put('playground/with-metadata.txt', 'Has metadata', {
    contentType: 'text/plain',
    metadata: { author: 'playground', env: 'dev' },
}));

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

// ─── getUrl ──────────────────────────────────────────────────────────────────

console.log('\n--- getUrl ---');
console.log(client.getUrl('playground/stream.txt'));

// ─── getSignedUrl ─────────────────────────────────────────────────────────────
// Note: requires a real service account private key. With the Fake GCS Server
// and a self-signed key this will either succeed with a fake URL or throw a
// signing error depending on the emulator version.

console.log('\n--- getSignedUrl: read (10 min) ---');
try {
    console.log(await client.getSignedUrl('playground/buffer.txt', { operation: 'read', expiresInSeconds: 600 }));
} catch (err) {
    console.log('Signed URL error (expected with dummy key):', (err as Error).message);
}

console.log('\n--- getSignedUrl: write (10 min) ---');
try {
    console.log(await client.getSignedUrl('playground/buffer.txt', { operation: 'write', expiresInSeconds: 600 }));
} catch (err) {
    console.log('Signed URL error (expected with dummy key):', (err as Error).message);
}

// ─── middleware: logUploads ───────────────────────────────────────────────────

console.log('\n--- middleware: logUploads ---');
const loggedClient = new StorageClient(gcs).use(logUploads());
await loggedClient.put('playground/logged.txt', 'upload tracked by logUploads middleware');

// ─── middleware: validateMimeType ─────────────────────────────────────────────

console.log('\n--- middleware: validateMimeType (allowed) ---');
const strictClient = new StorageClient(gcs)
    .use(validateMimeType({ allowed: ['text/plain', 'application/json'] }));
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
const sizedClient = new StorageClient(gcs).use(maxFileSize({ maxBytes: 1024 }));
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
const chainedClient = new StorageClient(gcs)
    .use(logUploads())
    .use(validateMimeType({ allowed: ['text/plain'] }))
    .use(maxFileSize({ maxBytes: 512 }));
console.log(await chainedClient.put('playground/chained.txt', 'passes all three checks', { contentType: 'text/plain' }));

// ─── RetryingDriver ───────────────────────────────────────────────────────────

console.log('\n--- RetryingDriver ---');
const retrying = new RetryingDriver(gcs, { maxAttempts: 3, baseDelayMs: 200 });
const retryClient = new StorageClient(retrying);
console.log(`driver name: ${retrying.name}`);
console.log(await retryClient.put('playground/retry.txt', 'uploaded through the retrying driver'));
console.log(await retryClient.stat('playground/retry.txt'));

console.log('\nDone.');
