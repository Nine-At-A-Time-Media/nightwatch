/**
 * UptimeProbe -- the seam for checking a URL (architecture Seams: Uptime
 * check). `fetch` from the monitors Worker in production, a fake in tests.
 * A check never throws: a URL that cannot be reached, answers too slowly or
 * answers with a failing status is a down Probe Result with the reason.
 */

import type { ProbeResult } from '../domain/monitor/uptime-monitor.js';

export interface UptimeProbe {
  /** Checks the URL once; `at` is when the check finished. */
  check(url: string): Promise<ProbeResult>;
}
