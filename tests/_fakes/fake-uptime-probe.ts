/**
 * FakeUptimeProbe -- an UptimeProbe that answers each URL from a script, in
 * order, and up once the script runs out. A down answer's reason is
 * `unreachable`. Results are stamped with the clock's time; the URLs
 * checked are kept for assertions.
 */

import type { ProbeResult } from '../../src/domain/monitor/uptime-monitor.js';
import type { Clock } from '../../src/ports/clock.js';
import type { UptimeProbe } from '../../src/ports/uptime-probe.js';

export class FakeUptimeProbe implements UptimeProbe {
  readonly checked: string[] = [];
  readonly #clock: Clock;
  readonly #scripts = new Map<string, ProbeResult['status'][]>();

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  answer(url: string, statuses: readonly ProbeResult['status'][]): void {
    this.#scripts.set(url, [...statuses]);
  }

  async check(url: string): Promise<ProbeResult> {
    this.checked.push(url);
    const status = this.#scripts.get(url)?.shift() ?? 'up';
    return { status, reason: status === 'down' ? 'unreachable' : null, at: this.#clock.now() };
  }
}
