import { describe, expect, it } from 'vitest';
import { advanceMonitor } from '../../../../src/application/monitors/advance-monitor.js';
import { newCronMonitor, type CronMonitorConfig } from '../../../../src/domain/monitor/cron-monitor.js';
import { monitorIssueId, type Monitor } from '../../../../src/domain/monitor/monitor.js';
import type { MonitorThresholds } from '../../../../src/domain/monitor/monitor-state.js';
import { NEW_UPTIME_MONITOR } from '../../../../src/domain/monitor/uptime-monitor.js';
import { FakeClock } from '../../../_fakes/fake-clock.js';
import { FakeEffectQueue } from '../../../_fakes/effect-queue.js';
import { FakeIds } from '../../../_fakes/fake-ids.js';
import { FakeMonitorStore } from '../../../_fakes/fake-monitor-store.js';
import { FakeProjectClient } from '../../../_fakes/fake-project-client.js';
import { FakeUptimeProbe } from '../../../_fakes/fake-uptime-probe.js';
import { DAY, HOUR, MINUTE, policies, T0 } from '../../domain/issue/fixtures.js';

const PROJECT = 'project-1';
const CRON = 'mon-cron';
const UPTIME = 'mon-uptime';
const URL = 'https://status.example/health';

function world() {
  const clock = new FakeClock(T0);
  const effects = new FakeEffectQueue();
  const projects = new FakeProjectClient({ clock, ids: new FakeIds(), effects, policies, dedupWindow: DAY });
  return { clock, effects, projects, monitors: new FakeMonitorStore(), probe: new FakeUptimeProbe(clock) };
}

type World = ReturnType<typeof world>;

/** An hourly Cron Monitor created at T0: it expects runs at T0+1h, T0+2h, ... with a 5 minute margin and 30 minute maximum runtime. */
function addCron(w: World, thresholds: MonitorThresholds): void {
  const config: CronMonitorConfig = {
    schedule: { kind: 'interval', every: 1, unit: 'hour' },
    margin: 5 * MINUTE,
    maxRuntime: 30 * MINUTE,
    thresholds,
  };
  const monitor: Monitor = { kind: 'cron', monitorId: CRON, projectId: PROJECT, issueId: null, config, state: newCronMonitor(config, T0) };
  w.monitors.seed(monitor);
}

/** Ticks the Cron Monitor at `at`, as its alarm would. */
async function tick(w: World, at: number) {
  w.clock.set(at);
  return advanceMonitor(CRON, null, w);
}

async function checkIn(w: World, status: 'in_progress' | 'ok' | 'error', at: number) {
  w.clock.set(at);
  return advanceMonitor(CRON, { status, at }, w);
}

describe('advanceMonitor', () => {
  it('Missed check-in: Given a Cron Monitor, When no check-in arrives by its expected time plus margin, Then a missed Failure is recorded', async () => {
    const w = world();
    addCron(w, { failureThreshold: 2, recoveryThreshold: 1 });

    expect(await tick(w, T0 + HOUR + 4 * MINUTE)).toBeNull();
    expect(w.monitors.failuresOf(CRON)).toEqual([]);

    expect(await tick(w, T0 + HOUR + 5 * MINUTE)).toBeNull();
    expect(w.monitors.failuresOf(CRON)).toEqual([{ kind: 'missed', at: T0 + HOUR + 5 * MINUTE, reason: null }]);
    expect(w.monitors.get(CRON)).resolves.toMatchObject({ state: { expectedAt: T0 + 2 * HOUR } });
  });

  it('Overlong run: Given a run in progress, When it exceeds its maximum runtime, Then a timeout Failure is recorded', async () => {
    const w = world();
    addCron(w, { failureThreshold: 2, recoveryThreshold: 1 });

    await checkIn(w, 'in_progress', T0 + HOUR);
    await tick(w, T0 + HOUR + 29 * MINUTE);
    expect(w.monitors.failuresOf(CRON)).toEqual([]);

    await tick(w, T0 + HOUR + 30 * MINUTE);
    expect(w.monitors.failuresOf(CRON)).toEqual([{ kind: 'timeout', at: T0 + HOUR + 30 * MINUTE, reason: null }]);
  });

  it('Monitor issue opens and resolves: Given consecutive Failures past the threshold, When the last is recorded, Then a monitor issue opens; When consecutive successes pass the recovery threshold, Then it resolves', async () => {
    const w = world();
    addCron(w, { failureThreshold: 2, recoveryThreshold: 2 });
    const openedAt = T0 + 2 * HOUR + 5 * MINUTE;
    const issueId = monitorIssueId(CRON, openedAt);

    expect(await tick(w, T0 + HOUR + 5 * MINUTE)).toBeNull();
    expect(await tick(w, openedAt)).toEqual({ kind: 'issue-opened', at: openedAt });
    expect(await w.projects.getIssue(PROJECT, issueId)).toMatchObject({ status: 'unresolved', substatus: 'new', count: 0 });
    expect(await w.projects.store(PROJECT).fingerprintsOf(issueId)).toEqual([]);
    expect(w.effects.enqueued.map((c) => [c.issueId, c.kind])).toEqual([
      [issueId, 'status'],
      [issueId, 'for_review'],
    ]);

    expect(await checkIn(w, 'ok', T0 + 3 * HOUR)).toBeNull();
    expect(await w.projects.getIssue(PROJECT, issueId)).toMatchObject({ status: 'unresolved' });

    expect(await checkIn(w, 'ok', T0 + 4 * HOUR)).toEqual({ kind: 'issue-resolved', at: T0 + 4 * HOUR });
    expect(await w.projects.getIssue(PROJECT, issueId)).toMatchObject({ status: 'resolved', resolution: { kind: 'plain' } });
    expect(await w.monitors.get(CRON)).toMatchObject({ issueId: null, state: { counts: { status: 'ok' } } });
  });

  it('opens a second monitor issue when the monitor fails again after resolving', async () => {
    const w = world();
    addCron(w, { failureThreshold: 1, recoveryThreshold: 1 });
    await tick(w, T0 + HOUR + 5 * MINUTE);
    await checkIn(w, 'ok', T0 + 2 * HOUR);
    await tick(w, T0 + 3 * HOUR + 5 * MINUTE);

    const issues = await w.projects.store(PROJECT).listIssues();
    expect(issues.map((issue) => [issue.issueId, issue.status])).toEqual([
      [monitorIssueId(CRON, T0 + HOUR + 5 * MINUTE), 'resolved'],
      [monitorIssueId(CRON, T0 + 3 * HOUR + 5 * MINUTE), 'unresolved'],
    ]);
  });

  it('URL down: Given an Uptime Monitor, When checks fail past the Uptime Failure Count, Then a monitor issue opens', async () => {
    const w = world();
    w.monitors.seed({
      kind: 'uptime',
      monitorId: UPTIME,
      projectId: PROJECT,
      issueId: null,
      url: URL,
      config: { uptimeFailureCount: 3, recoveryCount: 1 },
      state: NEW_UPTIME_MONITOR,
    });
    w.probe.answer(URL, ['down', 'down', 'down']);

    expect(await advanceMonitor(UPTIME, null, w)).toBeNull();
    w.clock.advance(MINUTE);
    expect(await advanceMonitor(UPTIME, null, w)).toBeNull();
    w.clock.advance(MINUTE);
    expect(await advanceMonitor(UPTIME, null, w)).toEqual({ kind: 'issue-opened', at: T0 + 2 * MINUTE });

    expect(w.probe.checked).toEqual([URL, URL, URL]);
    expect(w.monitors.failuresOf(UPTIME)).toEqual([{ kind: 'down', at: T0 + 2 * MINUTE, reason: 'down' }]);
    expect(await w.projects.getIssue(PROJECT, monitorIssueId(UPTIME, T0 + 2 * MINUTE))).toMatchObject({ status: 'unresolved' });
  });

  it('changes nothing for an unknown monitor or an input it does not take', async () => {
    const w = world();
    addCron(w, { failureThreshold: 1, recoveryThreshold: 1 });
    const before = await w.monitors.get(CRON);
    expect(await advanceMonitor('mon-unknown', null, w)).toBeNull();
    expect(await advanceMonitor(CRON, { status: 'down', reason: 'x', at: T0 }, w)).toBeNull();
    expect(await w.monitors.get(CRON)).toEqual(before);
    expect(w.probe.checked).toEqual([]);
  });
});
