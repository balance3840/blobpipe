import { describe, afterAll } from 'vitest';
import { AzureBlobDriver } from '@blobpipe/azure-blob';
import { testDriverContract } from '../helpers/driver-contract.js';

const AZURE_CONTAINER = process.env.AZURE_CONTAINER;
const AZURE_CONNECTION_STRING = process.env.AZURE_CONNECTION_STRING;

const SKIP = !AZURE_CONTAINER || !AZURE_CONNECTION_STRING;

const keyPrefix = `blobpipe-test-${Date.now()}/`;

describe.skipIf(SKIP)('Azure Blob integration', () => {
  const makeDriver = () =>
    new AzureBlobDriver({
      containerName: AZURE_CONTAINER!,
      auth: {
        mode: 'connection-string',
        connectionString: AZURE_CONNECTION_STRING!,
      },
      keyPrefix,
    });

  testDriverContract('azure-blob', makeDriver, { supportsMetadata: true });

  afterAll(async () => {
    const driver = makeDriver();
    for await (const obj of driver.list({ prefix: keyPrefix })) {
      await driver.delete(obj.key);
    }
  });
});
