import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { AzureBlobDriver } from '@blobpipe/azure-blob';
import { StorageClient, fromUrl } from '@blobpipe/core';
import { DefaultAzureCredential } from '@azure/identity';

const azure = new AzureBlobDriver({
    containerName: 'config',
    auth: {
        mode: 'connection-string',
        connectionString: 'UseDevelopmentStorage=true'
    }
    // auth: {
    //     mode: 'token-credential',
    //     accountName: 'hococostoragedev',
    //     credential: new DefaultAzureCredential()
    // }
    // auth: {
    //     mode: 'shared-key',
    //     accountName: 'devstoreaccount1',
    //     accountKey: 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==',
    //     endpoint: 'http://127.0.0.1:10000/devstoreaccount1'
    // }
});

// DefaultAzureCredential is imported above for the commented-out token-credential example.
void DefaultAzureCredential;

const client = new StorageClient(azure);

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
// token-credential → user delegation SAS (needs "Storage Blob Delegator" role)
// shared-key / connection-string → service SAS (same as Azure Storage Explorer)

console.log('\n--- getSignedUrl: read (10 min) ---');
const readUrl = await client.getSignedUrl('playground/stream.txt', { operation: 'read', expiresInSeconds: 600 });
console.log(readUrl);
// User delegation SAS has skoid/sktid/skt/ske/sks/skv params.
// Service SAS (Storage Explorer) has only sv/spr/st/se/sr/sp/sig.
const urlParams = new URL(readUrl).searchParams;
console.log('SAS type:', urlParams.has('skoid') ? 'user delegation' : 'service (shared key)');

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

console.log('\nDone.');
