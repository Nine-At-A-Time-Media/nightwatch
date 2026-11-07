/**
 * Uptime Monitor -- a URL checked on an interval (design Releases and
 * monitors, Uptime Monitor; Behavior URL down). Each check yields a Probe
 * Result, up or down.
 *
 * Consecutive down checks reaching the Uptime Failure Count are a down
 * Failure and open the monitor issue; every further consecutive down check
 * is a Failure too. Consecutive up checks reaching the recovery count
 * resolve it. So the Uptime Failure Count and the recovery count are this
 * monitor's failure and recovery thresholds in the shared state table.
 * Scheduling the checks on the Uptime interval is the caller's.
 */

import {
  INITIAL_MONITOR_COUNTS,
  parseMonitorThresholds,
  recordFailure,
  recordSuccess,
  type Failure,
  type MonitorCounts,
  type MonitorStep,
  type MonitorThresholds,
} from './monitor-state.js';
import { isRefusal, type Refusal } from '../refusal.js';

/** One check of the URL; `reason` says why a down check failed. */
export type ProbeResult = { readonly status: 'up' | 'down'; readonly reason: string | null; readonly at: number };

/** Per monitor; each at least one (design Parameters). */
export type UptimeMonitorConfig = { readonly uptimeFailureCount: number; readonly recoveryCount: number };

export type UptimeMonitorState = { readonly counts: MonitorCounts };

export const NEW_UPTIME_MONITOR: UptimeMonitorState = { counts: INITIAL_MONITOR_COUNTS };

// --- helpers ---

function thresholdsOf(config: UptimeMonitorConfig): MonitorThresholds {
  return { failureThreshold: config.uptimeFailureCount, recoveryThreshold: config.recoveryCount };
}

function downFailures(counts: MonitorCounts, probe: ProbeResult, config: UptimeMonitorConfig): Failure[] {
  return counts.consecutiveFailures >= config.uptimeFailureCount ? [{ kind: 'down', at: probe.at, reason: probe.reason }] : [];
}

// --- exports ---

export function parseUptimeMonitorConfig(config: UptimeMonitorConfig): UptimeMonitorConfig | Refusal {
  const thresholds = parseMonitorThresholds(thresholdsOf(config));
  if (isRefusal(thresholds)) return thresholds;
  return { uptimeFailureCount: thresholds.failureThreshold, recoveryCount: thresholds.recoveryThreshold };
}

/** A check finished: counts it, recording a down Failure once the failed run reaches the Uptime Failure Count. */
export function onProbe(state: UptimeMonitorState, probe: ProbeResult, config: UptimeMonitorConfig): MonitorStep<UptimeMonitorState> {
  if (probe.status === 'up') {
    const step = recordSuccess(state.counts, thresholdsOf(config), probe.at);
    return { state: { counts: step.counts }, change: step.change, failures: [] };
  }
  const step = recordFailure(state.counts, thresholdsOf(config), probe.at);
  return { state: { counts: step.counts }, change: step.change, failures: downFailures(step.counts, probe, config) };
}
