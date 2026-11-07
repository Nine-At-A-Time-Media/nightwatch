/**
 * Monitor -- one Cron or Uptime Monitor as MonitorDO keeps it: its
 * configuration, its state, the Project it reports to and the monitor issue
 * it has open (design Releases and monitors, Cron Monitor, Uptime Monitor,
 * Monitor issues; State Machine: Cron and Uptime Monitor).
 *
 * `advance` moves a Monitor by one input. A Cron Monitor takes a Check-in,
 * or no input when its alarm fires (time passed). An Uptime Monitor takes a
 * Probe Result; checking the URL is the caller's. An input the monitor does
 * not take moves nothing. Each opening of a monitor issue gets its own
 * Issue id, named by the monitor and the time it opened, so repeating a step
 * opens the same issue rather than a second one.
 *
 * `nextAlarmAt` is when MonitorDO next wakes the monitor with no input
 * (architecture Mechanism: Releases, health and monitors): a Cron Monitor at
 * its expected run plus margin, or at the maximum runtime while a run is in
 * progress; an Uptime Monitor one Uptime interval after now. Wall-clock
 * times, never ingest times.
 */

import type { IssueId, ProjectId } from '../ids.js';
import { onCheckIn, onTick, type CheckIn, type CronMonitorConfig, type CronMonitorState } from './cron-monitor.js';
import type { MonitorStep } from './monitor-state.js';
import { onProbe, type ProbeResult, type UptimeMonitorConfig, type UptimeMonitorState } from './uptime-monitor.js';

export type MonitorId = string;

type MonitorBase = {
  readonly monitorId: MonitorId;
  readonly projectId: ProjectId;
  /** The monitor issue open now, or null when none is. */
  readonly issueId: IssueId | null;
};

export type CronMonitor = MonitorBase & { readonly kind: 'cron'; readonly config: CronMonitorConfig; readonly state: CronMonitorState };

export type UptimeMonitor = MonitorBase & {
  readonly kind: 'uptime';
  readonly url: string;
  /** The Uptime interval: milliseconds between checks of the URL (design Parameters). */
  readonly interval: number;
  readonly config: UptimeMonitorConfig;
  readonly state: UptimeMonitorState;
};

export type Monitor = CronMonitor | UptimeMonitor;

/** What moves a Monitor: a Check-in, a Probe Result, or null when time passed. */
export type MonitorInput = CheckIn | ProbeResult | null;

const MONITOR_ISSUE_PREFIX = 'monitor';

// --- predicates ---

export function isProbeResult(input: CheckIn | ProbeResult): input is ProbeResult {
  return input.status === 'up' || input.status === 'down';
}

// --- helpers ---

function advanceCron(monitor: CronMonitor, input: MonitorInput, now: number): MonitorStep<Monitor> | null {
  if (input !== null && isProbeResult(input)) return null;
  const step = input === null ? onTick(monitor.state, now, monitor.config) : onCheckIn(monitor.state, input, monitor.config);
  return { ...step, state: { ...monitor, state: step.state } };
}

function advanceUptime(monitor: UptimeMonitor, input: MonitorInput): MonitorStep<Monitor> | null {
  if (input === null || !isProbeResult(input)) return null;
  const step = onProbe(monitor.state, input, monitor.config);
  return { ...step, state: { ...monitor, state: step.state } };
}

function cronAlarmAt(monitor: CronMonitor): number {
  const { run, expectedAt } = monitor.state;
  return run === null ? expectedAt + monitor.config.margin : run.startedAt + monitor.config.maxRuntime;
}

// --- exports ---

/** Moves the Monitor by one input at `now`; null when it does not take that input. */
export function advance(monitor: Monitor, input: MonitorInput, now: number): MonitorStep<Monitor> | null {
  return monitor.kind === 'cron' ? advanceCron(monitor, input, now) : advanceUptime(monitor, input);
}

/** The Issue id of the monitor issue a monitor opens at `openedAt` (whole epoch ms, so the first hyphen after it ends it). */
export function monitorIssueId(monitorId: MonitorId, openedAt: number): IssueId {
  return `${MONITOR_ISSUE_PREFIX}-${openedAt}-${monitorId}`;
}

export function withIssue(monitor: Monitor, issueId: IssueId | null): Monitor {
  return { ...monitor, issueId };
}

/** When the monitor next needs a step with no input; a time already past means at once. */
export function nextAlarmAt(monitor: Monitor, now: number): number {
  return monitor.kind === 'cron' ? cronAlarmAt(monitor) : now + monitor.interval;
}
