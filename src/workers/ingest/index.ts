/**
 * The ingest Worker's entry point (architecture, Mechanism: Ingest): parse the
 * SDK request into an Arrival, call admitArrival, shape its Admission into the
 * HTTP answer. It also hosts LogDO and QuotaDO (see wrangler.jsonc for why here).
 * An admitted HTTP cron check-in is then forwarded to the monitors Worker
 * over its service binding; a failed forward is logged and does not change
 * the answer, since the check-in is already durable in the arrival log.
 */

import { admitArrival } from '../../application/admit-arrival.js';
import { ingestDeps, isLocalStage, type IngestBindings } from './deps.js';
import type { Admission } from '../../domain/ingest/admission.js';
import { admissionResponse, arrivalOf, checkInOf, preflightResponse, readBody, routeOf, type ForwardedCheckIn } from './http.js';

export { LogDO } from './log-do.js';
export { QuotaDO } from './quota-do.js';

/** The monitors Worker's check-in route; the host is ignored over a service binding. */
const MONITORS_CHECK_IN_URL = 'https://monitors.internal/check-in';

// --- helpers ---

function failure({ status, detail }: { status: number; detail: string }): Response {
  return Response.json({ detail }, { status });
}

// --- flow ---

async function forward(checkIn: ForwardedCheckIn, monitors: Fetcher): Promise<void> {
  try {
    const response = await monitors.fetch(MONITORS_CHECK_IN_URL, { method: 'POST', body: JSON.stringify(checkIn) });
    if (!response.ok) console.error(JSON.stringify({ event: 'ingest.check-in-not-taken', status: response.status }));
  } catch (error) {
    console.error(JSON.stringify({ event: 'ingest.check-in-forward-failed', error: String(error) }));
  }
}

async function forwardCheckIn({ admission, url, body, env }: { admission: Admission; url: URL; body: Uint8Array; env: IngestBindings }) {
  if (admission.decision !== 'admitted') return;
  const checkIn = checkInOf({ url, body });
  if (checkIn !== null) await forward(checkIn, env.MONITORS);
}

// --- entry ---

async function handle(request: Request, env: IngestBindings): Promise<Response> {
  if (!isLocalStage(env)) return failure({ status: 500, detail: 'stage-has-no-adapters' });
  const url = new URL(request.url);
  const route = routeOf(url.pathname);
  if (route === null) return failure({ status: 404, detail: 'not-found' });
  if (request.method === 'OPTIONS') return preflightResponse(request.headers.get('origin'));
  if (request.method !== 'POST') return failure({ status: 405, detail: 'method-not-allowed' });
  const arrival = arrivalOf({ route, url, headers: request.headers, body: await readBody(request) });
  const admission = await admitArrival(arrival, ingestDeps(env));
  if (route.endpoint === 'checkin') await forwardCheckIn({ admission, url, body: arrival.body, env });
  return admissionResponse({ admission, origin: arrival.origin });
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      console.error(JSON.stringify({ event: 'ingest.failed', error: String(error) }));
      return failure({ status: 500, detail: 'internal-error' });
    }
  },
} satisfies ExportedHandler<IngestBindings>;
