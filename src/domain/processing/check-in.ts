/**
 * Check-in items -- the Check-in an SDK `check_in` envelope item carries for
 * a Cron Monitor (design Behaviors: Missed check-in; architecture Mechanism,
 * Releases, health and monitors). Processing hands it to the monitor's
 * MonitorDO through MonitorClient, which times it on arrival there. The item
 * names its monitor by slug and its run's status; anything else it carries
 * (run id, duration, environment, monitor config) is not read.
 *
 * Only envelope items take this path: a check-in on the HTTP cron endpoint
 * is handed to its monitor by ingest when it is admitted.
 */

import type { ProjectId } from '../ids.js';
import type { CheckIn } from '../monitor/cron-monitor.js';
import type { MonitorId } from '../monitor/monitor.js';
import { isObject } from '../normalize/parts.js';
import type { EnvelopeItem } from '../protocol/envelope.js';
import { refusal, type Refusal } from '../refusal.js';
import { itemPayload } from './processing.js';

/** A Check-in addressed to one monitor of one Project, before the monitor times it. */
export type MonitorCheckIn = { readonly projectId: ProjectId; readonly monitorId: MonitorId; readonly status: CheckIn['status'] };

const MALFORMED = 'malformed-check-in';
const STATUSES: ReadonlySet<string> = new Set<CheckIn['status']>(['in_progress', 'ok', 'error']);

// --- predicates ---

function isStatus(value: unknown): value is CheckIn['status'] {
  return typeof value === 'string' && STATUSES.has(value);
}

// --- exports ---

export function monitorCheckIn(item: EnvelopeItem, projectId: ProjectId): MonitorCheckIn | Refusal {
  const payload = itemPayload(item);
  if (!isObject(payload)) return refusal(MALFORMED);
  const { monitor_slug: monitorId, status } = payload;
  if (typeof monitorId !== 'string' || monitorId === '' || !isStatus(status)) return refusal(MALFORMED);
  return { projectId, monitorId, status };
}
