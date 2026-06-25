import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', middleware: 'src/middleware/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
});
