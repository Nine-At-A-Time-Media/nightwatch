// Test projects: `unit` runs domain and application code in Node with fakes;
// `integration` runs Workers code inside workerd through the Cloudflare plugin,
// against the ingest Worker's local-stage config (no remote bindings), plus
// a local D1 `CONTROL` database and the control-plane migrations as
// `TEST_MIGRATIONS`, which suites apply with applyD1Migrations;
// `integration-core` does the same against the core Worker's (ProjectDO);
// `integration-notifier`, `integration-github` and `integration-inbound-mail`
// run each of those Workers' configs, with a test entry (tests/integration/
// <worker>/entry.ts) that also hosts ProjectDO, since a binding to another
// script needs a pre-bundled auxiliary Worker, and the local fake GitHub as
// a named entrypoint the Worker binds to; ProjectDO reads the core Worker's
// vars, and the secrets are generated per run;
// `widget` is the report widget package's own project (widget/vitest.config.ts).
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { unstable_readConfig } from 'wrangler';
import { defineConfig } from 'vitest/config';

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
          ...miniflare,
          durableObjects: { ...(miniflare['durableObjects'] as object), PROJECT: { className: 'ProjectDO', useSQLite: true } },
          bindings: {
            ...(miniflare['bindings'] as object),
            ...unstable_readConfig({ config: './src/workers/core/wrangler.jsonc' }).vars,
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
              d1Databases: ['CONTROL'],
              bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations') },
            },
          })),
        ],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          exclude: ['tests/integration/{core,notifier,github,inbound-mail}/**'],
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
    ],
  },
});
