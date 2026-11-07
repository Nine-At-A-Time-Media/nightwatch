/**
 * FetchUptimeProbe -- UptimeProbe over `fetch` from the monitors Worker
 * (architecture Seams: Uptime check). One GET per check, following
 * redirects, under a signal that aborts after the per-monitor timeout. A
 * 2xx answer is up; any other status, a timeout, or no answer at all is
 * down, with the reason. The body is never read. `fetch`, the clock and the
 * timeout signal are injected, so a test sends nothing.
 */

import type { ProbeResult } from '../../domain/monitor/uptime-monitor.js';
import type { Clock } from '../../ports/clock.js';
import type { UptimeProbe } from '../../ports/uptime-probe.js';

export type ProbeFetch = (url: string, init: { signal: AbortSignal; method: string; redirect: 'follow' }) => Promise<Response>;

export type FetchUptimeProbeOptions = {
  readonly fetch: ProbeFetch;
  readonly clock: Clock;
  /** Milliseconds a check may take before it is down with reason `timeout`. */
  readonly timeout: number;
  /** A signal that aborts after the given milliseconds; AbortSignal.timeout when omitted. */
  readonly signalAfter?: (ms: number) => AbortSignal;
};

const TIMEOUT_ERRORS = new Set(['TimeoutError', 'AbortError']);

// --- predicates ---

function isTimeout(error: unknown): boolean {
  return error instanceof Error && TIMEOUT_ERRORS.has(error.name);
}

// --- helpers ---

function reasonFor(error: unknown): string {
  return isTimeout(error) ? 'timeout' : 'unreachable';
}

function resultOf(response: Response, at: number): ProbeResult {
  if (response.ok) return { status: 'up', reason: null, at };
  return { status: 'down', reason: `status ${response.status}`, at };
}

// --- exports ---

export class FetchUptimeProbe implements UptimeProbe {
  readonly #options: FetchUptimeProbeOptions;

  constructor(options: FetchUptimeProbeOptions) {
    this.#options = options;
  }

  async check(url: string): Promise<ProbeResult> {
    const { fetch, clock, timeout, signalAfter = (ms: number) => AbortSignal.timeout(ms) } = this.#options;
    try {
      const response = await fetch(url, { signal: signalAfter(timeout), method: 'GET', redirect: 'follow' });
      await response.body?.cancel();
      return resultOf(response, clock.now());
    } catch (error) {
      return { status: 'down', reason: reasonFor(error), at: clock.now() };
    }
  }
}
