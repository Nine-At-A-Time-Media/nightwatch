// CloudflareUsageSource: one GraphQL Analytics API query for the account's
// use since the start of the current UTC month, summed per product; the
// fetch is injected, so no request leaves. NoUsageSource, the local stand-in,
// measures nothing.
import { describe, expect, it } from 'vitest';
import { CloudflareUsageSource, NoUsageSource } from '../../../../src/adapters/cf-usage/cloudflare-usage-source.js';
import { FakeClock } from '../../../_fakes/fake-clock.js';

const NOW = Date.UTC(2026, 10, 7, 15, 30);

type Sent = { url: string; headers: Headers; body: { query: string; variables: Record<string, string> } };

function answering(data: unknown, sent: Sent[], status = 200) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    sent.push({ url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) as Sent['body'] });
    return new Response(JSON.stringify(data), { status });
  };
}

const ACCOUNTS = {
  data: {
    viewer: {
      accounts: [
        {
          workersInvocationsAdaptive: [{ sum: { requests: 1200 } }, { sum: { requests: 34 } }],
          durableObjectsInvocationsAdaptiveGroups: [{ sum: { requests: 7 } }],
        },
      ],
    },
  },
};

describe('CloudflareUsageSource', () => {
  it("sums each product's use since the start of the month, asking for the account with its token", async () => {
    const sent: Sent[] = [];
    const source = new CloudflareUsageSource({
      fetch: answering(ACCOUNTS, sent),
      clock: new FakeClock(NOW),
      accountId: 'account-1',
      apiToken: 'token-1',
    });

    expect(await source.usage()).toEqual([
      { product: 'workers_requests', used: 1234 },
      { product: 'durable_objects_requests', used: 7 },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://api.cloudflare.com/client/v4/graphql');
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer token-1');
    expect(sent[0]?.body.variables).toEqual({
      accountTag: 'account-1',
      since: '2026-11-01T00:00:00.000Z',
      until: new Date(NOW).toISOString(),
    });
  });

  it('reads an account with no use as zero', async () => {
    const empty = { data: { viewer: { accounts: [{ workersInvocationsAdaptive: [], durableObjectsInvocationsAdaptiveGroups: [] }] } } };
    const source = new CloudflareUsageSource({ fetch: answering(empty, []), clock: new FakeClock(NOW), accountId: 'a', apiToken: 't' });
    expect(await source.usage()).toEqual([
      { product: 'workers_requests', used: 0 },
      { product: 'durable_objects_requests', used: 0 },
    ]);
  });

  it('throws when the API refuses or answers errors, so the comparison is not made on nothing', async () => {
    const refused = new CloudflareUsageSource({ fetch: answering({}, [], 403), clock: new FakeClock(NOW), accountId: 'a', apiToken: 't' });
    await expect(refused.usage()).rejects.toThrow(/403/);
    const errors = { data: null, errors: [{ message: 'not authorized' }] };
    const failing = new CloudflareUsageSource({ fetch: answering(errors, []), clock: new FakeClock(NOW), accountId: 'a', apiToken: 't' });
    await expect(failing.usage()).rejects.toThrow(/not authorized/);
  });
});

describe('NoUsageSource', () => {
  it('measures nothing, so no product is ever over its limit locally', async () => {
    expect(await new NoUsageSource().usage()).toEqual([]);
  });
});
