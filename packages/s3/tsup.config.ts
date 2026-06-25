import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ['@blobpipe/core', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
});
