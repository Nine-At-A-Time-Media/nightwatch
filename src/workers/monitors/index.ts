/**
 * The monitors Worker's entry point (architecture, Module map:
 * src/workers/monitors). It hosts MonitorDO and MetricRuleDO, whose alarms
 * do their work, and takes the HTTP cron check-ins the ingest Worker
 * forwards after admitting them, handing each to the MonitorDO of its
 * Project and monitor.
 */

import { isRefusal } from '../../domain/refusal.js';
import type { MonitorsBindings } from './deps.js';
import { checkInRequestOf, isCheckInRoute, monitorObjectName } from './http.js';

export { MetricRuleDO } from './metric-rule-do.js';
export { MonitorDO } from './monitor-do.js';

// --- helpers ---

function answer({ status, body }: { status: number; body: object }): Response {
  return Response.json(body, { status });
}

async function bodyOf(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// --- entry ---

async function handle(request: Request, env: MonitorsBindings): Promise<Response> {
  if (!isCheckInRoute(request)) return answer({ status: 404, body: { detail: 'not-found' } });
  const checkIn = checkInRequestOf(await bodyOf(request));
  if (checkIn === null) return answer({ status: 400, body: { detail: 'malformed-check-in' } });
  const change = await env.MONITOR.getByName(monitorObjectName(checkIn)).checkIn(checkIn);
  if (isRefusal(change)) return answer({ status: 404, body: { detail: change.refusal } });
  return answer({ status: 200, body: { change } });
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      console.error(JSON.stringify({ event: 'monitors.failed', error: String(error) }));
      return answer({ status: 500, body: { detail: 'internal-error' } });
    }
  },
} satisfies ExportedHandler<MonitorsBindings>;
