import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts', 'src/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
  // SWC handles decorators + emitDecoratorMetadata for Vitest's TS transformer.
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true, legacyDecorator: true },
      },
    }),
  ],
});
