// QuotaGate contract: the QuotaDO-backed adapter and the in-memory fake
// decide the same way. An allowed check consumes its quantity; a denied one
// consumes nothing and advises a retry for that category; one Project's
// exhausted Quota never refuses another; no limit means unbounded.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DurableQuotaGate } from '../../../src/adapters/do/durable-quota-gate.js';
import { KvProjectConfigSource } from '../../../src/adapters/kv/kv-project-config-source.js';
import type { ProjectConfig } from '../../../src/domain/ingest/arrival.js';
import type { DataCategory } from '../../../src/domain/protocol/retry-advice.js';
import type { QuotaGate } from '../../../src/ports/quota-gate.js';
import { FakeClock } from '../../_fakes/fake-clock.js';
import { FakeQuotaGate } from '../../_fakes/fake-quota-gate.js';

type Limits = Record<string, Partial<Record<DataCategory, number>>>;

const WINDOW_SECONDS = 60;
const START = 1_700_000_040_000; // 40 seconds into a 60-second window

const config: ProjectConfig = {
  clientKeys: [{ publicKey: 'k1', active: true }],
  allowedOrigins: ['*'],
  sizeLimits: { event: 1000, attachment: 1000, arrival: 1000 },
  inboundFilters: { browserExtensions: false, localhost: false, webCrawlers: false, releases: [], messages: [], addresses: [] },
};

async function durableGate(limits: Limits, clock: FakeClock): Promise<QuotaGate> {
  for (const [projectId, perCategory] of Object.entries(limits)) {
    await env.PROJECT_CONFIG.put(projectId, JSON.stringify({ ...config, quotas: { windowSeconds: WINDOW_SECONDS, limits: perCategory } }));
  }
  return new DurableQuotaGate({
    limits: new KvProjectConfigSource(env.PROJECT_CONFIG),
    counterFor: (projectId) => env.QUOTA.getByName(projectId),
    clock,
  });
}

const check = (gate: QuotaGate, projectId: string, category: DataCategory, quantity: number) =>
  gate.check({ projectId, publicKey: 'k1', category, quantity });

describe.each<{ name: string; make: (limits: Limits, clock: FakeClock) => Promise<QuotaGate> }>([
  { name: 'FakeQuotaGate', make: async (limits) => new FakeQuotaGate(limits) },
  { name: 'DurableQuotaGate', make: durableGate },
])('QuotaGate contract -- $name', ({ make }) => {
  it('allows up to the limit, then denies that category with retry advice', async () => {
    const project = crypto.randomUUID();
    const gate = await make({ [project]: { error: 3 } }, new FakeClock(START));
    expect(await check(gate, project, 'error', 2)).toEqual({ allowed: true });
    expect(await check(gate, project, 'error', 1)).toEqual({ allowed: true });
    const denied = await check(gate, project, 'error', 1);
    expect(denied).toMatchObject({ allowed: false, advice: { categories: ['error'], scope: 'project', reason: 'quota-exceeded' } });
    expect(denied.allowed ? 0 : denied.advice.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('a denied check consumes nothing', async () => {
    const project = crypto.randomUUID();
    const gate = await make({ [project]: { error: 3 } }, new FakeClock(START));
    await check(gate, project, 'error', 2);
    expect((await check(gate, project, 'error', 2)).allowed).toBe(false);
    expect(await check(gate, project, 'error', 1)).toEqual({ allowed: true });
  });

  it("one Project's exhausted Quota never refuses another", async () => {
    const noisy = crypto.randomUUID();
    const quiet = crypto.randomUUID();
    const gate = await make({ [noisy]: { error: 1 }, [quiet]: { error: 1 } }, new FakeClock(START));
    await check(gate, noisy, 'error', 1);
    expect((await check(gate, noisy, 'error', 1)).allowed).toBe(false);
    expect(await check(gate, quiet, 'error', 1)).toEqual({ allowed: true });
  });

  it('categories are counted apart, and a category without a limit is unbounded', async () => {
    const project = crypto.randomUUID();
    const gate = await make({ [project]: { error: 1 } }, new FakeClock(START));
    await check(gate, project, 'error', 1);
    expect(await check(gate, project, 'feedback', 1000)).toEqual({ allowed: true });
  });

  it('a Project with no Quotas is unbounded', async () => {
    const gate = await make({}, new FakeClock(START));
    expect(await check(gate, crypto.randomUUID(), 'error', 1000)).toEqual({ allowed: true });
  });
});

describe('DurableQuotaGate', () => {
  it('advises a retry when the current window ends, and the next window starts afresh', async () => {
    const project = crypto.randomUUID();
    const clock = new FakeClock(START);
    const gate = await durableGate({ [project]: { error: 1 } }, clock);
    await check(gate, project, 'error', 1);
    expect(await check(gate, project, 'error', 1)).toMatchObject({ allowed: false, advice: { retryAfterSeconds: 20 } });
    clock.time += 20_000;
    expect(await check(gate, project, 'error', 1)).toEqual({ allowed: true });
  });
});
