// ServiceMonitorClient -- the MonitorClient over the monitors Worker's
// check-in route, reached through a service binding. The binding's fetch is
// injected, so nothing is sent.
import { describe, expect, it } from 'vitest';
import { ServiceMonitorClient } from '../../../../src/adapters/fetch/service-monitor-client.js';

const checkIn = { projectId: 'p1', monitorId: 'nightly', status: 'ok' } as const;

function binding(answer: Response) {
  const sent: { url: string; method: string | undefined; body: unknown }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) });
    return answer;
  };
  return { sent, client: new ServiceMonitorClient({ fetch }) };
}

describe('ServiceMonitorClient', () => {
  it('posts the check-in to the monitors Worker and answers the monitor issue change it made', async () => {
    const { sent, client } = binding(Response.json({ change: { kind: 'issue-resolved', at: 5 } }));
    expect(await client.checkIn(checkIn)).toEqual({ kind: 'issue-resolved', at: 5 });
    expect(sent).toEqual([{ url: 'https://monitors.internal/check-in', method: 'POST', body: checkIn }]);
  });

  it('answers no change when the monitor made none', async () => {
    expect(await binding(Response.json({ change: null })).client.checkIn(checkIn)).toBeNull();
  });

  it('refuses a check-in the Worker refuses, with its reason', async () => {
    expect(await binding(Response.json({ detail: 'unknown-monitor' }, { status: 404 })).client.checkIn(checkIn)).toEqual({
      refusal: 'unknown-monitor',
    });
    expect(await binding(Response.json({ detail: 'malformed-check-in' }, { status: 400 })).client.checkIn(checkIn)).toEqual({
      refusal: 'malformed-check-in',
    });
  });

  it('throws when the Worker fails, so the record is retried', async () => {
    await expect(binding(new Response('down', { status: 500 })).client.checkIn(checkIn)).rejects.toThrow(/500/);
  });
});
