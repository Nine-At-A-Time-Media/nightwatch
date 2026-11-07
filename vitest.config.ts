// Test projects: `unit` runs domain and application code in Node with fakes;
// `integration` runs Workers code inside workerd through the Cloudflare plugin,
// against the ingest Worker's local-stage config (no remote bindings), plus
// a local D1 `CONTROL` database and the control-plane migrations as
// `TEST_MIGRATIONS`, which suites apply with applyD1Migrations, and a
// `MONITORS` stand-in that records each forwarded check-in in KV;
// `integration-core` does the same against the core Worker's (ProjectDO);
// `integration-monitors` and `integration-scheduler` run their Worker's
// config with a test entry that also hosts ProjectDO (built from the core
// Worker's vars), since a cross-script Durable Object needs a pre-bundled
// auxiliary Worker under the plugin; outbound fetches answer by host
// (`down.example.test` 503, `up.example.test` 200), so no request leaves;
// `widget` is the report widget package's own project (widget/vitest.config.ts).
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { unstable_readConfig } from 'wrangler';

/** ProjectDO's settings, read from the core Worker's config so a test entry hosting it matches. */
const CORE_VARS = unstable_readConfig({ config: './src/workers/core/wrangler.jsonc' }).vars;

/** The KV access a service binding function gets from Miniflare, as far as recordCheckIn uses it. */
type KvHost = { getKVNamespace(name: string): Promise<{ put(key: string, value: string): Promise<unknown> }> };

/** The ingest project's monitors Worker: keeps each forwarded check-in in KV under its Project, for the test to read. */
async function recordCheckIn(request: { json(): Promise<unknown> }, mf: KvHost) {
  const checkIn = (await request.json()) as { projectId: string };
  const kv = await mf.getKVNamespace('PROJECT_CONFIG');
  await kv.put(`forwarded-check-in:${checkIn.projectId}`, JSON.stringify(checkIn));
  return new Response(JSON.stringify({ change: null }));
}

/** What a hosted ProjectDO needs beside its vars, and the fake outbound network. */
const HOSTED_PROJECT_DO = {
  durableObjects: { PROJECT: { className: 'ProjectDO', useSQLite: true } },
  queueProducers: { EFFECTS: { queueName: 'nightwatch-effects' } },
  r2Buckets: ['BLOBS'],
  outboundService: (request: Request) => {
    const host = new URL(request.url).hostname;
    if (host === 'up.example.test') return new Response('ok');
    return new Response('unavailable', { status: host === 'down.example.test' ? 503 : 502 });
  },
};

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
              serviceBindings: { MONITORS: recordCheckIn },
            },
          })),
        ],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          exclude: ['tests/integration/core/**', 'tests/integration/monitors/**', 'tests/integration/scheduler/**'],
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
      {
        plugins: [
          cloudflareTest(async () => ({
            remoteBindings: false,
            main: './tests/integration/monitors/worker.ts',
            wrangler: { configPath: './src/workers/monitors/wrangler.jsonc' },
            additionalExports: { ProjectDO: 'DurableObject' },
            miniflare: { ...HOSTED_PROJECT_DO, bindings: { ...CORE_VARS, TEST_MIGRATIONS: await readD1Migrations('./migrations') } },
          })),
        ],
        test: {
          name: 'integration-monitors',
          include: ['tests/integration/monitors/**/*.test.ts'],
          testTimeout: 10_000,
        },
      },
      'widget/vitest.config.ts',
    ],
  },
});
