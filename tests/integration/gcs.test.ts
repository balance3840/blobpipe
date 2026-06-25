import { describe, afterAll } from 'vitest';
import { GcsDriver } from '@blobpipe/gcs';
import { testDriverContract } from '../helpers/driver-contract.js';

const GCS_BUCKET = process.env.GCS_BUCKET;
const GCS_PROJECT_ID = process.env.GCS_PROJECT_ID;
const GCS_CLIENT_EMAIL = process.env.GCS_CLIENT_EMAIL;
const GCS_PRIVATE_KEY = process.env.GCS_PRIVATE_KEY;

const SKIP = !GCS_BUCKET || !GCS_PROJECT_ID || !GCS_CLIENT_EMAIL || !GCS_PRIVATE_KEY;

const keyPrefix = `blobpipe-test-${Date.now()}/`;

describe.skipIf(SKIP)('GCS integration', () => {
  const makeDriver = () =>
    new GcsDriver({
      bucket: GCS_BUCKET!,
      auth: {
        mode: 'credentials',
        projectId: GCS_PROJECT_ID!,
        clientEmail: GCS_CLIENT_EMAIL!,
        privateKey: GCS_PRIVATE_KEY!,
      },
      keyPrefix,
    });

  testDriverContract('gcs', makeDriver, { supportsMetadata: true });

  afterAll(async () => {
    const driver = makeDriver();
    for await (const obj of driver.list({ prefix: keyPrefix })) {
      await driver.delete(obj.key);
    }
  });
});
