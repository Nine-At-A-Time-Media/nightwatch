/**
 * advanceMonitor -- one step of a Cron or Uptime Monitor (design Behaviors:
 * Missed check-in, Overlong run, Monitor issue opens and resolves, URL
 * down). MonitorDO calls it with a Check-in, a Probe Result, or null when
 * its alarm fires; for an Uptime Monitor, null means it is time to check the
 * URL, so the step checks it through UptimeProbe. The monitor domain counts
 * the result. A monitor issue the step opens or resolves goes through
 * ProjectClient first; then the Failures and the new state are kept, so a
 * step retried after a crash reaches the same monitor issue. Returns the
 * monitor issue change, or null. Ports: MonitorStore, ProjectClient,
 * UptimeProbe, Clock.
 */

import type { MonitorChange, MonitorStep } from '../../domain/monitor/monitor-state.js';
import { advance, monitorIssueId, withIssue, type Monitor, type MonitorId, type MonitorInput } from '../../domain/monitor/monitor.js';
import type { Clock } from '../../ports/clock.js';
import type { MonitorStore } from '../../ports/monitor-store.js';
import type { ProjectClient } from '../../ports/project-client.js';
import type { UptimeProbe } from '../../ports/uptime-probe.js';

export type AdvanceMonitorDeps = { projects: ProjectClient; probe: UptimeProbe; clock: Clock; monitors: MonitorStore };

// --- flow ---

async function inputFor(monitor: Monitor, input: MonitorInput, probe: UptimeProbe): Promise<MonitorInput> {
  if (input !== null || monitor.kind !== 'uptime') return input;
  return probe.check(monitor.url);
}

/** Opens or resolves the monitor issue the step's change names; returns the monitor naming the issue open now. */
async function settleIssue(step: MonitorStep<Monitor>, projects: ProjectClient): Promise<Monitor> {
  const monitor = step.state;
  if (step.change?.kind === 'issue-opened') {
    const issueId = monitorIssueId(monitor.monitorId, step.change.at);
    await projects.openMonitorIssue(monitor.projectId, { issueId, at: step.change.at });
    return withIssue(monitor, issueId);
  }
  if (step.change?.kind === 'issue-resolved' && monitor.issueId !== null) {
    await projects.resolveMonitorIssue(monitor.projectId, { issueId: monitor.issueId, at: step.change.at });
    return withIssue(monitor, null);
  }
  return monitor;
}

// --- exports ---

export async function advanceMonitor(monitorId: MonitorId, input: MonitorInput, deps: AdvanceMonitorDeps): Promise<MonitorChange | null> {
  const monitor = await deps.monitors.get(monitorId);
  if (monitor === null) return null;
  const step = advance(monitor, await inputFor(monitor, input, deps.probe), deps.clock.now());
  if (step === null) return null;
  const settled = await settleIssue(step, deps.projects);
  if (step.failures.length > 0) await deps.monitors.recordFailures(monitorId, step.failures);
  await deps.monitors.put(settled);
  return step.change;
}
