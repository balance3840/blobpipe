import { describe, beforeAll, afterAll } from 'vitest';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { S3Driver } from '@blobpipe/s3';
import { testDriverContract } from '../helpers/driver-contract.js';

const LOCALSTACK_URL = 'http://localhost:4566';
const BUCKET = 'blobpipe-test';
const REGION = 'us-east-1';

async function isLocalstackAvailable(): Promise<boolean> {
  try {
    await fetch(`${LOCALSTACK_URL}/_localstack/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return true;
  } catch {
    return false;
  }
}

const available = await isLocalstackAvailable();

const s3Client = new S3Client({
  region: REGION,
  endpoint: LOCALSTACK_URL,
  forcePathStyle: true,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

// Each makeDriver() call gets a unique keyPrefix so tests never share state.
const makeDriver = () =>
  new S3Driver({
    bucket: BUCKET,
    region: REGION,
    endpoint: LOCALSTACK_URL,
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    keyPrefix: `blobpipe-test-${Date.now()}-${Math.random().toString(36).slice(2)}/`,
    // LocalStack returns wrong checksums for range requests — disable automatic validation.
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });

describe.skipIf(!available)('s3 (localstack)', () => {
  beforeAll(async () => {
    await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET }));
  });

  testDriverContract('s3 (localstack)', makeDriver, { supportsMetadata: true });

  afterAll(async () => {
    // Container is ephemeral in CI; unique keybPrefixes prevent cross-test pollution.
  });
});
