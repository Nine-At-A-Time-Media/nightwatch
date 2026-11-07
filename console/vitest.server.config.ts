// Test project `console-server`: the entry-point handlers (server/handlers)
// called as plain functions in Node with a Request, the root's in-memory
// fakes behind the use cases. `#nightwatch` resolves to the root package's
// src/, as in nuxt.config.ts.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '#nightwatch': fileURLToPath(new URL('../src', import.meta.url)) } },
  test: {
    name: 'console-server',
    root: import.meta.dirname,
    include: ['tests/server/**/*.test.ts'],
    environment: 'node',
    globals: false,
    sequence: { shuffle: true },
    testTimeout: 1000,
  },
});
