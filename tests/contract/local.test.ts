import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDriver } from '@restrella/blobpipe-local';
import { testDriverContract } from '../helpers/driver-contract.js';

testDriverContract('LocalDriver', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'blobpipe-test-'));
  return new LocalDriver({ rootDir, publicBaseUrl: 'http://localhost:3000/files' });
});
