import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@blobpipe/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@blobpipe/memory': fileURLToPath(new URL('./packages/memory/src/index.ts', import.meta.url)),
      '@blobpipe/local': fileURLToPath(new URL('./packages/local/src/index.ts', import.meta.url)),
      '@blobpipe/s3': fileURLToPath(new URL('./packages/s3/src/index.ts', import.meta.url)),
      '@blobpipe/gcs': fileURLToPath(new URL('./packages/gcs/src/index.ts', import.meta.url)),
      '@blobpipe/azure-blob': fileURLToPath(new URL('./packages/azure-blob/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/integration/**/*.test.ts', 'packages/*/tests/**/*.test.ts'],
    exclude: ['tests/emulator/**'],
  },
});
