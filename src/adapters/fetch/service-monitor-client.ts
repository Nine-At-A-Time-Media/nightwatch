/**
 * ServiceMonitorClient -- MonitorClient over the monitors Worker's check-in
 * route (POST /check-in, the one the ingest Worker forwards HTTP cron
 * check-ins to), reached through a service binding. A 2xx answer carries the
 * monitor issue change; 404 and 400 are the Worker refusing the check-in,
 * with its reason; any other status throws, so the record is retried. The
 * binding's fetch is injected.
 */

import type { MonitorChange } from '../../domain/monitor/monitor-state.js';
import type { MonitorCheckIn } from '../../domain/processing/check-in.js';
import { refusal, type Refusal } from '../../domain/refusal.js';
import type { MonitorClient } from '../../ports/monitor-client.js';

export type ServiceFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The monitors Worker's check-in route; the host is ignored over a service binding. */
const CHECK_IN_URL = 'https://monitors.internal/check-in';
const REFUSING = new Set([400, 404]);
const UNKNOWN = 'unknown-monitor';

// --- helpers ---

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// --- exports ---

export class ServiceMonitorClient implements MonitorClient {
  readonly #fetch: ServiceFetch;

  constructor({ fetch }: { fetch: ServiceFetch }) {
    this.#fetch = fetch;
  }

  async checkIn(checkIn: MonitorCheckIn): Promise<MonitorChange | null | Refusal> {
    const response = await this.#fetch(CHECK_IN_URL, { method: 'POST', body: JSON.stringify(checkIn) });
    const body = await bodyOf(response);
    if (REFUSING.has(response.status)) return refusal(typeof body['detail'] === 'string' ? body['detail'] : UNKNOWN);
    if (!response.ok) throw new Error(`the monitors Worker failed a check-in with status ${response.status}`);
    return (body['change'] as MonitorChange | null | undefined) ?? null;
  }
}
