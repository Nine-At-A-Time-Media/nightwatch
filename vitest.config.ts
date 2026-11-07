// Test projects: `unit` runs domain and application code in Node with fakes;
// `integration` runs Workers code inside workerd through the Cloudflare plugin,
// against the ingest Worker's local-stage config (no remote bindings), plus
// a local D1 `CONTROL` database and the control-plane migrations as
// `TEST_MIGRATIONS`, which suites apply with applyD1Migrations;
// `integration-core` does the same against the core Worker's (ProjectDO);
// `widget` is the report widget package's own project (widget/vitest.config.ts);
// `console-server` and `console-components` are the console's (console/vitest.*.config.ts).
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
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
        plugins: [
          cloudflareTest(async () => ({
            remoteBindings: false,
            wrangler: { configPath: './src/workers/ingest/wrangler.jsonc' },
            miniflare: {
              d1Databases: ['CONTROL'],
              bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations') },
            },
          })),
        ],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          exclude: ['tests/integration/core/**'],
          testTimeout: 10_000,
        },
      },
      {
        plugins: [cloudflareTest({ remoteBindings: false, wrangler: { configPath: './src/workers/core/wrangler.jsonc' } })],
        test: {
          name: 'integration-core',
          include: ['tests/integration/core/**/*.test.ts'],
          testTimeout: 10_000,
        },
      },
      'widget/vitest.config.ts',
      'console/vitest.server.config.ts',
      'console/vitest.components.config.ts',
    ],
  },
});
