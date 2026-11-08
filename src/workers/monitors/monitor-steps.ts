/**
 * The MonitorDO steps -- one module function per MonitorDO operation, plus
 * the alarm (cloudflare-hosting: every step past authorization is a module
 * function, never a method). Each step that moves the monitor then sets the
 * object's one alarm to the monitor's next deadline (nextAlarmAt): the
 * expected run plus margin, the maximum runtime of a run in progress, or the
 * next uptime check. Alarms are wall-clock times, never ingest times.
 */

import { advanceMonitor } from '../../application/monitors/advance-monitor.js';
import type { ProjectId } from '../../domain/ids.js';
import type { CheckIn } from '../../domain/monitor/cron-monitor.js';
import type { Failure, MonitorChange } from '../../domain/monitor/monitor-state.js';
import { nextAlarmAt, type Monitor, type MonitorId } from '../../domain/monitor/monitor.js';
import { refusal, type Refusal } from '../../domain/refusal.js';
import type { MonitorRuntime } from './deps.js';

/** A forwarded HTTP check-in: the Project and monitor its route names, and the status the job reported. */
export type CheckInRequest = { readonly projectId: ProjectId; readonly monitorId: MonitorId; readonly status: CheckIn['status'] };

// --- predicates ---

function isHeldFor(monitor: Monitor | null, request: CheckInRequest): monitor is Monitor {
  return monitor !== null && monitor.projectId === request.projectId;
}

// --- flow: the alarm ---

/** Sets the alarm to the held monitor's next deadline; an object holding none keeps no alarm. */
async function arm(r: MonitorRuntime, monitorId: MonitorId): Promise<void> {
  const monitor = await r.monitors.get(monitorId);
  if (monitor === null) return;
  await r.storage.setAlarm(nextAlarmAt(monitor, r.clock.now()));
}

function advance(r: MonitorRuntime, monitorId: MonitorId, input: CheckIn | null): Promise<MonitorChange | null> {
  return advanceMonitor(monitorId, input, { projects: r.projects, probe: r.probe, clock: r.clock, monitors: r.monitors });
}

/** The alarm: a Cron Monitor counts what time passed; an Uptime Monitor checks its URL. Then the next alarm is set. */
export async function alarmStep(r: MonitorRuntime): Promise<void> {
  const monitorId = await r.monitors.heldMonitorId();
  if (monitorId === null) return;
  await advance(r, monitorId, null);
  await arm(r, monitorId);
}

// --- flow: operations ---

/** Keeps the monitor as configured (copied in from its monitor row) and sets its first alarm. */
export async function configureStep(r: MonitorRuntime, monitor: Monitor): Promise<void> {
  await r.monitors.put(monitor);
  await arm(r, monitor.monitorId);
}

/** A Check-in arrived for the monitor, timed on arrival here; a monitor this object does not hold for the Project is refused. */
export async function checkInStep(r: MonitorRuntime, request: CheckInRequest): Promise<MonitorChange | null | Refusal> {
  if (!isHeldFor(await r.monitors.get(request.monitorId), request)) return refusal('unknown-monitor');
  const change = await advance(r, request.monitorId, { status: request.status, at: r.clock.now() });
  await arm(r, request.monitorId);
  return change;
}

// --- flow: reads ---

export function monitorStep(r: MonitorRuntime, monitorId: MonitorId): Promise<Monitor | null> {
  return r.monitors.get(monitorId);
}

export function failuresStep(r: MonitorRuntime, monitorId: MonitorId): Promise<readonly Failure[]> {
  return r.monitors.failuresOf(monitorId);
}
