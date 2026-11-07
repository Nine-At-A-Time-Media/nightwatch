// The console's tests, run without the Nuxt runtime, as two projects:
// `console-server` (vitest.server.config.ts) and `console-components`
// (vitest.components.config.ts). The root vitest.config.ts lists both leaf
// files, so `pnpm test` at the root runs them too.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { projects: ['./vitest.server.config.ts', './vitest.components.config.ts'] },
});
