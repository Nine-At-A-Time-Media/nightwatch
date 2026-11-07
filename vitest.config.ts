// Test projects: `unit` runs domain and application code in Node with fakes;
// `integration` runs Workers code inside workerd through the Cloudflare plugin,
// against the ingest Worker's local-stage config (no remote bindings);
// `widget` is the report widget package's own project (widget/vitest.config.ts).
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    sequence: { shuffle: true },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          testTimeout: 1000,
        },
      },
      {
        plugins: [cloudflareTest({ remoteBindings: false, wrangler: { configPath: './src/workers/ingest/wrangler.jsonc' } })],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 10_000,
        },
      },
      'widget/vitest.config.ts',
    ],
  },
});
