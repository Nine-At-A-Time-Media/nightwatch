/**
 * The monitors Worker's HTTP surface: the one route the ingest Worker's
 * service binding reaches, POST /check-in, carrying a JSON check-in that
 * ingest already admitted. Parsing and shaping only; the monitor's rules are
 * the domain's.
 */

import type { CheckInRequest } from './monitor-steps.js';

const CHECK_IN_PATH = '/check-in';
const STATUSES: ReadonlySet<string> = new Set<CheckInRequest['status']>(['in_progress', 'ok', 'error']);

// --- predicates ---

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isStatus(value: unknown): value is CheckInRequest['status'] {
  return typeof value === 'string' && STATUSES.has(value);
}

// --- exports ---

export function isCheckInRoute(request: Request): boolean {
  return request.method === 'POST' && new URL(request.url).pathname === CHECK_IN_PATH;
}

/** The forwarded check-in, or null when the body is not one. */
export function checkInRequestOf(body: unknown): CheckInRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const { projectId, monitorId, status } = body as Record<string, unknown>;
  if (!isNonEmptyString(projectId) || !isNonEmptyString(monitorId) || !isStatus(status)) return null;
  return { projectId, monitorId, status };
}

/** The MonitorDO a monitor lives in is named by its Project and monitor, so two Projects' monitors never share one. */
export function monitorObjectName(request: Pick<CheckInRequest, 'projectId' | 'monitorId'>): string {
  return `${request.projectId}/${request.monitorId}`;
}
