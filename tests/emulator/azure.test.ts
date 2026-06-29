import { describe } from 'vitest';
import { AzureBlobDriver } from '@restrella/blobpipe-azure-blob';
import { testDriverContract } from '../helpers/driver-contract.js';

const AZURITE_URL = 'http://127.0.0.1:10000/devstoreaccount1';
const AZURITE_CONN_STR =
  'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;';

async function isAzuriteAvailable(): Promise<boolean> {
  try {
    await fetch(AZURITE_URL, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

const available = await isAzuriteAvailable();

// Each makeDriver() call gets a unique keyPrefix so tests never share state.
const makeDriver = () =>
  new AzureBlobDriver({
    containerName: 'blobpipe-test',
    auth: { mode: 'connection-string', connectionString: AZURITE_CONN_STR },
    keyPrefix: `blobpipe-test-${Date.now()}-${Math.random().toString(36).slice(2)}/`,
  });

describe.skipIf(!available)('azure-blob (azurite)', () => {
  // Azure driver auto-creates the container on first put — no beforeAll needed.
  testDriverContract('azure-blob (azurite)', makeDriver, { supportsMetadata: true });
});
