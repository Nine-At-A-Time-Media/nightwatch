// Test projects: `unit` runs domain and application code in Node with fakes;
// `integration` runs Workers code inside workerd through the Cloudflare plugin,
// against the ingest Worker's local-stage config (no remote bindings), plus
// a local D1 `CONTROL` database and the control-plane migrations as
// `TEST_MIGRATIONS`, which suites apply with applyD1Migrations, and a
// `MONITORS` stand-in that records each forwarded check-in in KV;
// `integration-core` does the same against the core Worker's (ProjectDO);
// `integration-notifier`, `integration-github` and `integration-inbound-mail`
// run each of those Workers' configs, with a test entry (tests/integration/
// <worker>/entry.ts) that also hosts ProjectDO and the local fake GitHub as
// a named entrypoint the Worker binds to; the secrets are generated per run;
// `integration-monitors` and `integration-scheduler` run their Worker's
// config with a test entry that also hosts ProjectDO (built from the core
// Worker's vars), since a cross-script Durable Object needs a pre-bundled
// auxiliary Worker under the plugin; outbound fetches answer by host
// (`down.example.test` 503, `up.example.test` 200), so no request leaves;
// `widget` is the report widget package's own project (widget/vitest.config.ts);
// `console-server` and `console-components` are the console's (console/vitest.*.config.ts).
import { generateKeyPairSync, randomUUID } from 'node:crypto';
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

/** Secrets each run generates, as `.dev.vars` would hold them. */
const SECRETS = {
  GITHUB_APP_PRIVATE_KEY: generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey,
  GITHUB_WEBHOOK_SECRET: randomUUID(),
  REPLY_TOKEN_SECRET: randomUUID(),
};

/** A Worker project whose test entry also hosts ProjectDO and the fake GitHub. */
function workerProject(worker: string, miniflare: Record<string, unknown> = {}) {
  return {
    plugins: [
      cloudflareTest(async () => ({
        remoteBindings: false,
        main: `./tests/integration/${worker}/entry.ts`,
        wrangler: { configPath: `./src/workers/${worker}/wrangler.jsonc` },
        miniflare: {
          r2Buckets: ['BLOBS'],
          ...miniflare,
          durableObjects: { ...(miniflare['durableObjects'] as object), PROJECT: { className: 'ProjectDO', useSQLite: true } },
          bindings: {
            ...(miniflare['bindings'] as object),
            ...CORE_VARS,
            ...SECRETS,
            TEST_MIGRATIONS: await readD1Migrations('./migrations'),
          },
        },
      })),
    ],
    test: { name: `integration-${worker}`, include: [`tests/integration/${worker}/**/*.test.ts`], testTimeout: 10_000 },
  };
}

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
              bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations') },
              serviceBindings: { MONITORS: recordCheckIn },
            },
          })),
        ],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          exclude: ['tests/integration/{core,monitors,scheduler,notifier,github,inbound-mail}/**'],
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
      {
        plugins: [
          cloudflareTest(async () => ({
            remoteBindings: false,
            main: './tests/integration/scheduler/worker.ts',
            wrangler: { configPath: './src/workers/scheduler/wrangler.jsonc' },
            additionalExports: { ProjectDO: 'DurableObject' },
            miniflare: { ...HOSTED_PROJECT_DO, bindings: { ...CORE_VARS, TEST_MIGRATIONS: await readD1Migrations('./migrations') } },
          })),
        ],
        test: {
          name: 'integration-scheduler',
          include: ['tests/integration/scheduler/**/*.test.ts'],
          testTimeout: 10_000,
        },
      },
      workerProject('notifier', {
        // ProjectDO's Issue Changes go to a queue nothing consumes, so no
        // test sees another's messages; tests hand the consumer its batches.
        queueProducers: { EFFECTS: { queueName: 'nightwatch-effects-test-sink' } },
        serviceBindings: { GITHUB_API: { name: 'nightwatch-notifier', entrypoint: 'FakeGitHubWorker' } },
      }),
      workerProject('github', {
        queueProducers: { EFFECTS: { queueName: 'nightwatch-effects-test-sink' } },
        serviceBindings: {
          GITHUB_API: { name: 'nightwatch-github', entrypoint: 'FakeGitHubWorker' },
          NIGHTWATCH_GITHUB: 'nightwatch-github',
        },
        kvNamespaces: ['GITHUB_TOKENS'],
        // openExternalIssue's Tracker, built in the test as the notifier builds it.
        bindings: { GITHUB_APP_ID: '1' },
      }),
      workerProject('inbound-mail', { queueProducers: { EFFECTS: { queueName: 'nightwatch-effects-test-sink' } } }),
      'widget/vitest.config.ts',
      'console/vitest.server.config.ts',
      'console/vitest.components.config.ts',
    ],
  },
});
