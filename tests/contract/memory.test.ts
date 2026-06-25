import { MemoryDriver } from '@blobpipe/memory';
import { testDriverContract } from '../helpers/driver-contract.js';

testDriverContract('MemoryDriver', () => new MemoryDriver(), { supportsMetadata: true });
