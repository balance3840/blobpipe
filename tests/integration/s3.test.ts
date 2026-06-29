import { describe, afterAll } from 'vitest';
import { S3Driver } from '@restrella/blobpipe-s3';
import { testDriverContract } from '../helpers/driver-contract.js';

const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.S3_REGION;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;

const SKIP = !S3_BUCKET || !S3_REGION || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY;

const keyPrefix = `blobpipe-test-${Date.now()}/`;

describe.skipIf(SKIP)('S3 integration', () => {
  const makeDriver = () =>
    new S3Driver({
      bucket: S3_BUCKET!,
      region: S3_REGION!,
      credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID!,
        secretAccessKey: AWS_SECRET_ACCESS_KEY!,
      },
      keyPrefix,
    });

  testDriverContract('s3', makeDriver, { supportsMetadata: true });

  afterAll(async () => {
    const driver = makeDriver();
    for await (const obj of driver.list({ prefix: keyPrefix })) {
      await driver.delete(obj.key);
    }
  });
});
