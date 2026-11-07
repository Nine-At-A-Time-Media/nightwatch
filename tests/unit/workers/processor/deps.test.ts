// The processor Worker's pure parts: settings read from its vars, the pump
// names, and the stage rule for sign-in (a deployed stage never trusts the
// local issuer).
import { describe, expect, it } from 'vitest';
import { pumpPlan, processingSettings, reportSettings, signInVerifier } from '../../../../src/workers/processor/deps.js';
import { pumpNames } from '../../../../src/workers/processor/pump-steps.js';

const vars = {
  STAGE: 'local',
  PUMP_COUNT: 2,
  PUMP_BATCH_SIZE: 50,
  PUMP_RETRY_BOUND: 5,
  PUMP_INTERVAL_MS: 1000,
  PUMP_LEASE_MS: 60000,
  CLAMP_FUTURE_MS: 60000,
  MAX_TAG_VALUE_LENGTH: 200,
  FOLLOW_UP_BASE_URL: 'http://localhost:8787/follow-up',
  MAX_MESSAGE_LENGTH: 10000,
  SPAM_THRESHOLD: 0.9,
  MAIL_FROM: 'nightwatch@localhost',
  LOCAL_ISSUER: { fetch: async () => new Response('{"keys":[]}') },
} as unknown as ProcessorEnv;

describe('processor settings', () => {
  it('reads the pump plan, processing and report settings from their vars', () => {
    expect(pumpPlan(vars)).toEqual({ count: 2, intervalMs: 1000, settings: { batchSize: 50, retryBound: 5 } });
    expect(processingSettings(vars)).toEqual({ clampFutureMs: 60000, maxTagValueLength: 200 });
    expect(reportSettings(vars)).toEqual({
      followUpBaseUrl: 'http://localhost:8787/follow-up',
      maxMessageLength: 10000,
      spamThreshold: 0.9,
    });
  });

  it('refuses a missing or non-positive number', () => {
    expect(() => pumpPlan({ ...vars, PUMP_RETRY_BOUND: 0 })).toThrow('PUMP_RETRY_BOUND');
    expect(() => pumpPlan({ ...vars, PUMP_COUNT: undefined } as unknown as ProcessorEnv)).toThrow('PUMP_COUNT');
  });
});

describe('pumpNames', () => {
  it('names each pump by its index', () => {
    expect(pumpNames(3)).toEqual(['pump-0', 'pump-1', 'pump-2']);
  });
});

describe('signInVerifier', () => {
  const unbound = { ...vars, LOCAL_ISSUER: undefined } as unknown as ProcessorEnv;

  it('a deployed stage with the local issuer bound refuses to start', () => {
    expect(() => signInVerifier({ ...vars, STAGE: 'prod' })).toThrow('LOCAL_ISSUER');
  });

  it('the local stage without the local issuer bound refuses to start', () => {
    expect(() => signInVerifier(unbound)).toThrow('LOCAL_ISSUER');
  });

  it('the local stage with the local issuer, and a deployed stage without it, each get a verifier', () => {
    expect(signInVerifier(vars)).toBeDefined();
    expect(signInVerifier({ ...unbound, STAGE: 'prod' })).toBeDefined();
  });
});
