// UptimeProbe contract: the fake and the fetch adapter agree on what a check
// returns -- up for a URL that answers, down with a reason for one that
// does not, stamped with the time the check finished, and never a throw.
// The fetch adapter runs against an injected fetch; no request leaves.
import { describe, expect, it } from 'vitest';
import { FetchUptimeProbe } from '../../../../src/adapters/fetch/uptime-probe.js';
import type { UptimeProbe } from '../../../../src/ports/uptime-probe.js';
import { FakeClock } from '../../../_fakes/fake-clock.js';
import { FakeUptimeProbe } from '../../../_fakes/fake-uptime-probe.js';

const T0 = Date.UTC(2026, 10, 1);
const HEALTHY = 'https://up.example/health';
const BROKEN = 'https://down.example/health';

type FetchLike = (url: string, init: { signal: AbortSignal; method: string }) => Promise<Response>;

function fakeFetch(clock: FakeClock, answers: Readonly<Record<string, number>>): FetchLike {
  return async (url) => {
    clock.advance(25);
    const status = answers[url];
    if (status === undefined) throw new TypeError('network unreachable');
    return new Response('body', { status });
  };
}

describe.each<{ name: string; make: (clock: FakeClock) => UptimeProbe }>([
  {
    name: 'FakeUptimeProbe',
    make: (clock) => {
      const probe = new FakeUptimeProbe(clock);
      probe.answer(BROKEN, ['down']);
      return probe;
    },
  },
  {
    name: 'FetchUptimeProbe',
    make: (clock) => new FetchUptimeProbe({ fetch: fakeFetch(clock, { [HEALTHY]: 200, [BROKEN]: 503 }), clock, timeout: 10_000 }),
  },
])('UptimeProbe contract -- $name', ({ make }) => {
  it('answers up for a URL that answers, stamped when the check finished', async () => {
    const clock = new FakeClock(T0);
    const result = await make(clock).check(HEALTHY);
    expect(result).toEqual({ status: 'up', reason: null, at: clock.now() });
  });

  it('answers down with a reason for a URL that fails', async () => {
    const clock = new FakeClock(T0);
    const result = await make(clock).check(BROKEN);
    expect(result.status).toBe('down');
    expect(result.reason).toEqual(expect.any(String));
    expect(result.at).toBe(clock.now());
  });
});

describe('FetchUptimeProbe', () => {
  it('sends a GET under a signal that aborts after the timeout', async () => {
    const clock = new FakeClock(T0);
    const seen: { url: string; method: string; timeout: number }[] = [];
    const timeouts: number[] = [];
    const probe = new FetchUptimeProbe({
      fetch: async (url, init) => {
        seen.push({ url, method: init.method, timeout: timeouts.at(-1) ?? -1 });
        return new Response(null, { status: 204 });
      },
      clock,
      timeout: 7_000,
      signalAfter: (ms) => {
        timeouts.push(ms);
        return new AbortController().signal;
      },
    });
    expect(await probe.check(HEALTHY)).toMatchObject({ status: 'up' });
    expect(seen).toEqual([{ url: HEALTHY, method: 'GET', timeout: 7_000 }]);
  });

  it('names why a check failed: the status, a timeout, or no answer', async () => {
    const clock = new FakeClock(T0);
    const answering = new FetchUptimeProbe({ fetch: fakeFetch(clock, { [BROKEN]: 503 }), clock, timeout: 10_000 });
    expect(await answering.check(BROKEN)).toMatchObject({ status: 'down', reason: 'status 503' });
    expect(await answering.check('https://nowhere.example/')).toMatchObject({ status: 'down', reason: 'unreachable' });

    const timedOut = new FetchUptimeProbe({
      fetch: async (_url, init) => {
        init.signal.throwIfAborted();
        return new Response(null, { status: 200 });
      },
      clock,
      timeout: 10_000,
      signalAfter: () => AbortSignal.abort(new DOMException('timed out', 'TimeoutError')),
    });
    expect(await timedOut.check(HEALTHY)).toMatchObject({ status: 'down', reason: 'timeout' });
  });

  it('counts a redirect it was not led through, and a client error, as down', async () => {
    const clock = new FakeClock(T0);
    const probe = new FetchUptimeProbe({ fetch: fakeFetch(clock, { [HEALTHY]: 404 }), clock, timeout: 10_000 });
    expect(await probe.check(HEALTHY)).toMatchObject({ status: 'down', reason: 'status 404' });
  });
});
