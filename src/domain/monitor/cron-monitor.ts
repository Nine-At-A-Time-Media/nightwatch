/**
 * Cron Monitor -- a scheduled job's Check-ins measured against its Schedule,
 * check-in margin and maximum runtime (design Releases and monitors, Cron
 * Monitor; Behaviors Missed check-in, Overlong run, Monitor issue opens and
 * resolves). Two pure steps advance it: `onTick` when time passes and
 * `onCheckIn` when the job reports.
 *
 * Each expected run yields one result, a success or a Failure:
 * - missed: no Check-in by the expected time plus margin;
 * - late: the run's first Check-in arrives after that deadline, before a
 *   tick recorded it as missed (an earlier unclaimed expected run is missed);
 * - error: the job reported a failed run;
 * - timeout: a run in progress passed its maximum runtime.
 * A late run is its Failure; the end of that run adds no further result.
 * An overlong run's own end, arriving before a tick, adds no success.
 *
 * The next expected run is counted from the Check-in that claims the
 * current one, so a crontab job expects its next slot after the run began
 * and an interval job one interval after it began. No expected run is
 * missed while a run is in progress; a slot that passed during the run is
 * skipped when it ends. An `in_progress` Check-in during a run in progress
 * keeps the first start. Every Failure from one step comes before any
 * success, so a step changes the monitor issue at most once.
 */

import { nextExpectedRun, type Schedule } from './schedule.js';
import {
  INITIAL_MONITOR_COUNTS,
  parseMonitorThresholds,
  recordFailure,
  recordSuccess,
  type Failure,
  type FailureKind,
  type MonitorChange,
  type MonitorCounts,
  type MonitorStep,
  type MonitorThresholds,
} from './monitor-state.js';
import { isRefusal, refusal, type Refusal } from '../refusal.js';

/** A job's report of one run; `at` is when it arrived, epoch ms. */
export type CheckIn = { readonly status: 'in_progress' | 'ok' | 'error'; readonly at: number };

/** Margin and maximum runtime are milliseconds, per monitor (design Parameters). */
export type CronMonitorConfig = {
  readonly schedule: Schedule;
  readonly margin: number;
  readonly maxRuntime: number;
  readonly thresholds: MonitorThresholds;
};

/** A run in progress: when it started, and whether its start was already recorded as late. */
export type Run = { readonly startedAt: number; readonly late: boolean };

export type CronMonitorState = {
  /** The next run the Schedule expects. */
  readonly expectedAt: number;
  readonly run: Run | null;
  readonly counts: MonitorCounts;
};

/** Where a step leaves the schedule, and the results it found, before counting. */
type Settlement = {
  readonly expectedAt: number;
  readonly run: Run | null;
  readonly failures: readonly Failure[];
  /** When the step recorded a success, or null when it recorded none. */
  readonly successAt: number | null;
};

// --- predicates ---

function isOverlong(run: Run | null, now: number, config: CronMonitorConfig): run is Run {
  return run !== null && now >= run.startedAt + config.maxRuntime;
}

function isMilliseconds(value: number, minimum: number): boolean {
  return Number.isInteger(value) && value >= minimum;
}

// --- helpers ---

function failure(kind: FailureKind, at: number): Failure {
  return { kind, at, reason: null };
}

/** The expected run after a run that ended at `end`: unchanged if still ahead, else the next one after the end. */
function expectedAfterRun(expectedAt: number, end: number, schedule: Schedule): number {
  return expectedAt > end ? expectedAt : nextExpectedRun(schedule, end);
}

/** Every expected run whose deadline has passed by `now`, each a missed Failure, and the run expected after them. */
function missedRuns(expectedAt: number, now: number, config: CronMonitorConfig): { expectedAt: number; failures: Failure[] } {
  const failures: Failure[] = [];
  let next = expectedAt;
  while (next + config.margin <= now) {
    failures.push(failure('missed', next + config.margin));
    next = nextExpectedRun(config.schedule, next);
  }
  return { expectedAt: next, failures };
}

/** Ends a run that passed its maximum runtime with a timeout Failure; otherwise changes nothing. */
function settleTimeout(state: CronMonitorState, now: number, config: CronMonitorConfig): Settlement {
  const unchanged: Settlement = { expectedAt: state.expectedAt, run: state.run, failures: [], successAt: null };
  if (!isOverlong(state.run, now, config)) return unchanged;
  const end = state.run.startedAt + config.maxRuntime;
  return {
    expectedAt: expectedAfterRun(state.expectedAt, end, config.schedule),
    run: null,
    failures: [failure('timeout', end)],
    successAt: null,
  };
}

function settleMissed(settled: Settlement, now: number, config: CronMonitorConfig): Settlement {
  if (settled.run !== null) return settled;
  const missed = missedRuns(settled.expectedAt, now, config);
  return { ...settled, expectedAt: missed.expectedAt, failures: [...settled.failures, ...missed.failures] };
}

/** A Check-in ending the run in progress. A late run already has its result. */
function endRun(params: { settled: Settlement; run: Run; checkIn: CheckIn; config: CronMonitorConfig }): Settlement {
  const { settled, run, checkIn, config } = params;
  const expectedAt = expectedAfterRun(settled.expectedAt, checkIn.at, config.schedule);
  if (run.late) return { ...settled, expectedAt, run: null };
  if (checkIn.status === 'error')
    return { ...settled, expectedAt, run: null, failures: [...settled.failures, failure('error', checkIn.at)] };
  return { ...settled, expectedAt, run: null, successAt: checkIn.at };
}

/** A Check-in with no run in progress: it claims the expected run, late if that run's deadline passed. */
function claimRun(settled: Settlement, checkIn: CheckIn, config: CronMonitorConfig): Settlement {
  const overdue = missedRuns(settled.expectedAt, checkIn.at, config).failures;
  const late = overdue.length > 0;
  const failures = [...settled.failures, ...overdue.slice(0, -1)];
  const expectedAt = nextExpectedRun(config.schedule, checkIn.at);
  if (checkIn.status === 'error') return { expectedAt, run: null, failures: [...failures, failure('error', checkIn.at)], successAt: null };
  const lateFailures = late ? [...failures, failure('late', checkIn.at)] : failures;
  if (checkIn.status === 'in_progress')
    return { expectedAt, run: { startedAt: checkIn.at, late }, failures: lateFailures, successAt: null };
  return { expectedAt, run: null, failures: lateFailures, successAt: late ? null : checkIn.at };
}

/** Counts a step's results, Failures first, keeping the one monitor issue change they cause. */
function finish(settled: Settlement, counts: MonitorCounts, config: CronMonitorConfig): MonitorStep<CronMonitorState> {
  let next = counts;
  let change: MonitorChange | null = null;
  for (const found of settled.failures) {
    const step = recordFailure(next, config.thresholds, found.at);
    next = step.counts;
    change = change ?? step.change;
  }
  if (settled.successAt !== null) {
    const step = recordSuccess(next, config.thresholds, settled.successAt);
    next = step.counts;
    change = change ?? step.change;
  }
  return { state: { expectedAt: settled.expectedAt, run: settled.run, counts: next }, change, failures: settled.failures };
}

// --- flow ---

function settleCheckIn(state: CronMonitorState, checkIn: CheckIn, config: CronMonitorConfig): Settlement {
  const settled = settleTimeout(state, checkIn.at, config);
  const endsOverlongRun = state.run !== null && settled.run === null && checkIn.status !== 'in_progress';
  if (endsOverlongRun) return settleMissed(settled, checkIn.at, config);
  if (settled.run === null) return claimRun(settled, checkIn, config);
  if (checkIn.status === 'in_progress') return settled;
  return endRun({ settled, run: settled.run, checkIn, config });
}

// --- exports ---

export function parseCronMonitorConfig(config: CronMonitorConfig): CronMonitorConfig | Refusal {
  const thresholds = parseMonitorThresholds(config.thresholds);
  if (isRefusal(thresholds)) return thresholds;
  if (!isMilliseconds(config.margin, 0) || !isMilliseconds(config.maxRuntime, 1)) return refusal('invalid-monitor-config');
  return { schedule: config.schedule, margin: config.margin, maxRuntime: config.maxRuntime, thresholds };
}

/** A Cron Monitor created at `now`: OK, expecting the Schedule's first run after `now`. */
export function newCronMonitor(config: CronMonitorConfig, now: number): CronMonitorState {
  return { expectedAt: nextExpectedRun(config.schedule, now), run: null, counts: INITIAL_MONITOR_COUNTS };
}

/** Time has reached `now`: records an overlong run as a timeout, then each expected run past its deadline as missed. */
export function onTick(state: CronMonitorState, now: number, config: CronMonitorConfig): MonitorStep<CronMonitorState> {
  return finish(settleMissed(settleTimeout(state, now, config), now, config), state.counts, config);
}

/** A Check-in arrived: settles any overlong run, then starts, ends or claims a run. */
export function onCheckIn(state: CronMonitorState, checkIn: CheckIn, config: CronMonitorConfig): MonitorStep<CronMonitorState> {
  return finish(settleCheckIn(state, checkIn, config), state.counts, config);
}
