/**
 * The ingest Worker's entry point (architecture, Mechanism: Ingest): parse the
 * SDK request into an Arrival, call admitArrival, shape its Admission into the
 * HTTP answer. It also hosts LogDO and QuotaDO (see wrangler.jsonc for why here).
 */

import { admitArrival } from '../../application/admit-arrival.js';
import { ingestDeps, isLocalStage, type IngestBindings } from './deps.js';
import { admissionResponse, arrivalOf, preflightResponse, readBody, routeOf } from './http.js';

export { LogDO } from './log-do.js';
export { QuotaDO } from './quota-do.js';

// --- helpers ---

function failure({ status, detail }: { status: number; detail: string }): Response {
  return Response.json({ detail }, { status });
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
