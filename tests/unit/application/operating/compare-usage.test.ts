// compareUsage -- the scheduler's comparison of Platform Usage with the
// Platform Soft Limits, driven by its architecture signature over a fake
// UsageSource and fake Channels.
import { describe, expect, it } from 'vitest';
import { compareUsage } from '../../../../src/application/operating/compare-usage.js';
import { FakeChannel } from '../../../_fakes/fake-channel.js';
import { FakeClock } from '../../../_fakes/fake-clock.js';
import { FakeUsageSource } from '../../../_fakes/fake-usage-source.js';

const NOW = Date.UTC(2026, 10, 7);
const OPERATOR = { kind: 'email', address: 'ops@example.com' } as const;
const PAGER = { kind: 'webhook', url: 'https://hooks.example/ops' } as const;

function world(used: Record<string, number>) {
  const usage = new FakeUsageSource(Object.entries(used).map(([product, amount]) => ({ product, used: amount })));
  const email = new FakeChannel('email');
  const webhook = new FakeChannel('webhook');
  const deps = {
    usage,
    channels: [email, webhook],
    clock: new FakeClock(NOW),
    limits: new Map([
      ['workers_requests', 100_000],
      ['k2_storage_bytes', 1_000_000],
    ]),
    operator: [OPERATOR, PAGER],
  };
  return { email, webhook, deps };
}

describe('compareUsage', () => {
  it('Soft limit crossed: Given Platform Usage above its Platform Soft Limit, When usage is compared, Then the operator is alerted and no Arrival is refused for that reason', async () => {
    const w = world({ workers_requests: 150_000, k2_storage_bytes: 10 });

    const compared = await compareUsage(w.deps);

    expect(compared).toEqual([
      { product: 'workers_requests', used: 150_000, softLimit: 100_000, over: true },
      { product: 'k2_storage_bytes', used: 10, softLimit: 1_000_000, over: false },
    ]);
    expect(w.email.delivered.map((delivery) => delivery.destination)).toEqual([OPERATOR]);
    expect(w.webhook.delivered.map((delivery) => delivery.destination)).toEqual([PAGER]);
    expect(w.email.delivered[0]?.message.subject).toContain('workers_requests');
    // compareUsage's only effect is the alert: no port it holds can refuse an Arrival.
    expect(Object.keys(w.deps).sort()).toEqual(['channels', 'clock', 'limits', 'operator', 'usage']);
  });

  it('alerts no one when every product is within its limit', async () => {
    const w = world({ workers_requests: 100_000 });
    await compareUsage(w.deps);
    expect([...w.email.attempts, ...w.webhook.attempts]).toEqual([]);
  });

  it('a failed delivery to one destination still reaches the others', async () => {
    const w = world({ k2_storage_bytes: 2_000_000 });
    w.email.failure = { retryable: true };
    await compareUsage(w.deps);
    expect(w.webhook.delivered).toHaveLength(1);
  });
});
