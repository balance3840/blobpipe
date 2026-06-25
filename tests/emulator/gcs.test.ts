import { describe, beforeAll, afterAll } from 'vitest';
import { Storage } from '@google-cloud/storage';
import { GcsDriver } from '@restrella/blobpipe-gcs';
import { testDriverContract } from '../helpers/driver-contract.js';

const GCS_EMULATOR_URL = 'http://localhost:4443';
const BUCKET = 'blobpipe-test';

async function isFakeGcsAvailable(): Promise<boolean> {
  try {
    await fetch(`${GCS_EMULATOR_URL}/storage/v1/b`, {
      signal: AbortSignal.timeout(2000),
    });
    return true;
  } catch {
    return false;
  }
}

const available = await isFakeGcsAvailable();

const adminStorage = new Storage({
  apiEndpoint: GCS_EMULATOR_URL,
  projectId: 'test',
});

// Each makeDriver() call gets a unique keyPrefix so tests never share state.
const makeDriver = () =>
  new GcsDriver({
    bucket: BUCKET,
    auth: { mode: 'adc', projectId: 'test' },
    apiEndpoint: GCS_EMULATOR_URL,
    keyPrefix: `blobpipe-test-${Date.now()}-${Math.random().toString(36).slice(2)}/`,
  });

describe.skipIf(!available)('gcs (fake-gcs-server)', () => {
  beforeAll(async () => {
    try {
      await adminStorage.createBucket(BUCKET);
    } catch (err: unknown) {
      // 409 = bucket already exists from a previous run; that's fine.
      if ((err as { code?: number }).code !== 409) throw err;
    }
  });

  testDriverContract('gcs (fake-gcs-server)', makeDriver, { supportsMetadata: true, supportsSignedUrls: false });

  afterAll(async () => {
    // Container is ephemeral in CI; unique keybPrefixes prevent cross-test pollution.
  });
});
