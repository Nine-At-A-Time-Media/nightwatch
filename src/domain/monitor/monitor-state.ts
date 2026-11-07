/**
 * Monitor state -- the consecutive counting shared by Cron and Uptime
 * Monitors (design State Machine: Cron and Uptime Monitor; Releases and
 * monitors, Monitor issues), and the values a monitor step returns.
 *
 * | From       | Result  | To                                                     |
 * |------------|---------|--------------------------------------------------------|
 * | OK         | Failure | Failing, or Incident when the failure threshold is met |
 * | Failing    | Failure | Incident once consecutive Failures reach the threshold |
 * | Failing    | success | OK (the run breaks)                                    |
 * | Incident   | Failure | Incident                                               |
 * | Incident   | success | Recovering, or OK when the recovery threshold is met   |
 * | Recovering | success | OK once consecutive successes reach the threshold      |
 * | Recovering | Failure | Incident (the run breaks)                              |
 *
 * Entering Incident opens the monitor issue; leaving it for OK resolves it.
 * A success in OK and a Failure in Incident change only the counts.
 */

import { refusal, type Refusal } from '../refusal.js';

export type MonitorStatus = 'ok' | 'failing' | 'incident' | 'recovering';

export type MonitorCounts = {
  readonly status: MonitorStatus;
  readonly consecutiveFailures: number;
  readonly consecutiveSuccesses: number;
};

/** Per monitor; each at least one (design Parameters). */
export type MonitorThresholds = { readonly failureThreshold: number; readonly recoveryThreshold: number };

/** A monitor issue opening or resolving, at the time of the result that caused it. */
export type MonitorChange = { readonly kind: 'issue-opened' | 'issue-resolved'; readonly at: number };

/** missed, timeout (overlong) and error are a Cron Monitor's; down is an Uptime Monitor's. */
export type FailureKind = 'missed' | 'timeout' | 'error' | 'down';

/** A missed, overlong, failed or down result, recorded once per expected run. */
export type Failure = { readonly kind: FailureKind; readonly at: number; readonly reason: string | null };

export type CountsStep = { readonly counts: MonitorCounts; readonly change: MonitorChange | null };

export const INITIAL_MONITOR_COUNTS: MonitorCounts = { status: 'ok', consecutiveFailures: 0, consecutiveSuccesses: 0 };

// --- predicates ---

function isValidThreshold(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

function isIssueOpen(status: MonitorStatus): boolean {
  return status === 'incident' || status === 'recovering';
}

// --- helpers ---

function failureStatus(status: MonitorStatus, consecutiveFailures: number, thresholds: MonitorThresholds): MonitorStatus {
  if (isIssueOpen(status)) return 'incident';
  return consecutiveFailures >= thresholds.failureThreshold ? 'incident' : 'failing';
}

function successStatus(status: MonitorStatus, consecutiveSuccesses: number, thresholds: MonitorThresholds): MonitorStatus {
  if (!isIssueOpen(status)) return 'ok';
  return consecutiveSuccesses >= thresholds.recoveryThreshold ? 'ok' : 'recovering';
}

function changeBetween(params: { from: MonitorStatus; to: MonitorStatus; at: number }): MonitorChange | null {
  const { from, to, at } = params;
  if (!isIssueOpen(from) && isIssueOpen(to)) return { kind: 'issue-opened', at };
  if (isIssueOpen(from) && !isIssueOpen(to)) return { kind: 'issue-resolved', at };
  return null;
}

// --- exports ---

export function parseMonitorThresholds(thresholds: MonitorThresholds): MonitorThresholds | Refusal {
  if (!isValidThreshold(thresholds.failureThreshold) || !isValidThreshold(thresholds.recoveryThreshold)) {
    return refusal('invalid-monitor-threshold');
  }
  return { failureThreshold: thresholds.failureThreshold, recoveryThreshold: thresholds.recoveryThreshold };
}

export function recordFailure(counts: MonitorCounts, thresholds: MonitorThresholds, at: number): CountsStep {
  const consecutiveFailures = counts.consecutiveFailures + 1;
  const status = failureStatus(counts.status, consecutiveFailures, thresholds);
  return {
    counts: { status, consecutiveFailures, consecutiveSuccesses: 0 },
    change: changeBetween({ from: counts.status, to: status, at }),
  };
}

export function recordSuccess(counts: MonitorCounts, thresholds: MonitorThresholds, at: number): CountsStep {
  const consecutiveSuccesses = counts.consecutiveSuccesses + 1;
  const status = successStatus(counts.status, consecutiveSuccesses, thresholds);
  return {
    counts: { status, consecutiveFailures: 0, consecutiveSuccesses },
    change: changeBetween({ from: counts.status, to: status, at }),
  };
}
