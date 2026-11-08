import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { newCronMonitor, type CronMonitorConfig } from '../../../../src/domain/monitor/cron-monitor.js';
import { advance, monitorIssueId, nextAlarmAt, withIssue, type Monitor } from '../../../../src/domain/monitor/monitor.js';
import { createMonitorIssue, resolveMonitorIssue } from '../../../../src/domain/monitor/monitor-issue.js';
import { NEW_UPTIME_MONITOR } from '../../../../src/domain/monitor/uptime-monitor.js';
import { archive } from '../../../../src/domain/issue/commands.js';
import { isRefusal } from '../../../../src/domain/refusal.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = Date.UTC(2026, 10, 1);

const cronConfig: CronMonitorConfig = {
  schedule: { kind: 'interval', every: 1, unit: 'hour' },
  margin: 5 * MINUTE,
  maxRuntime: 30 * MINUTE,
  thresholds: { failureThreshold: 1, recoveryThreshold: 1 },
};

const cron: Monitor = {
  kind: 'cron',
  monitorId: 'mon-1',
  projectId: 'project-1',
  issueId: null,
  config: cronConfig,
  state: newCronMonitor(cronConfig, T0),
};

const uptime: Monitor = {
  kind: 'uptime',
  monitorId: 'mon-2',
  projectId: 'project-1',
  issueId: null,
  url: 'https://status.example/health',
  interval: MINUTE,
  config: { uptimeFailureCount: 1, recoveryCount: 1 },
  state: NEW_UPTIME_MONITOR,
};

describe('advance', () => {
  it('ticks a Cron Monitor when nothing arrived, recording each missed run', () => {
    const step = advance(cron, null, T0 + HOUR + 5 * MINUTE);
    expect(step?.failures).toEqual([{ kind: 'missed', at: T0 + HOUR + 5 * MINUTE, reason: null }]);
    expect(step?.change).toEqual({ kind: 'issue-opened', at: T0 + HOUR + 5 * MINUTE });
    expect(step?.state).toMatchObject({ kind: 'cron', monitorId: 'mon-1', state: { expectedAt: T0 + 2 * HOUR } });
  });

  it('takes a Check-in on a Cron Monitor and a Probe Result on an Uptime Monitor', () => {
    expect(advance(cron, { status: 'ok', at: T0 + HOUR }, T0 + HOUR)).toMatchObject({ change: null, failures: [] });
    const down = advance(uptime, { status: 'down', reason: 'timeout', at: T0 }, T0);
    expect(down).toMatchObject({ change: { kind: 'issue-opened', at: T0 }, failures: [{ kind: 'down', at: T0, reason: 'timeout' }] });
  });

  it('ignores an input the monitor does not take', () => {
    expect(advance(cron, { status: 'up', reason: null, at: T0 }, T0)).toBeNull();
    expect(advance(uptime, { status: 'ok', at: T0 }, T0)).toBeNull();
    expect(advance(uptime, null, T0)).toBeNull();
  });
});

describe('monitorIssueId and withIssue', () => {
  it('names one monitor issue per monitor and opening time', () => {
    fc.assert(
      fc.property(fc.string(), fc.nat(), fc.string(), fc.nat(), (a, atA, b, atB) => {
        const same = a === b && atA === atB;
        return (monitorIssueId(a, atA) === monitorIssueId(b, atB)) === same;
      }),
    );
  });

  it('records which monitor issue is open', () => {
    expect(withIssue(cron, 'issue-9').issueId).toBe('issue-9');
    expect(withIssue(withIssue(uptime, 'issue-9'), null)).toEqual(uptime);
  });
});

describe('monitor issue', () => {
  it('opens Unresolved/New in For Review, holding no Fingerprint or Event', () => {
    const opened = createMonitorIssue({ issueId: 'issue-1', at: T0 });
    expect(opened.state).toMatchObject({ issueId: 'issue-1', status: 'unresolved', substatus: 'new', count: 0, forReviewSince: T0 });
    expect(opened.changes.map((c) => [c.kind, c.to])).toEqual([
      ['status', 'unresolved/new'],
      ['for_review', 'in'],
    ]);
  });

  it('resolves plainly when the monitor recovers, unless a Member already moved it out of Unresolved', () => {
    const opened = createMonitorIssue({ issueId: 'issue-1', at: T0 });
    const resolved = resolveMonitorIssue(opened.state, T0 + HOUR);
    expect(resolved.state).toMatchObject({ status: 'resolved', resolution: { kind: 'plain' } });
    expect(resolved.changes.map((c) => [c.kind, c.actor])).toContainEqual(['status', 'system']);

    const archived = archive(opened.state, { substatus: 'forever', spam: false }, { member: 'm' }, T0);
    if (isRefusal(archived)) throw new Error(archived.refusal);
    expect(resolveMonitorIssue(archived.state, T0 + HOUR)).toEqual({ state: archived.state, changes: [] });
  });
});

describe('nextAlarmAt', () => {
  it('wakes a Cron Monitor at its expected run plus margin while no run is in progress', () => {
    expect(nextAlarmAt(cron, T0)).toBe(T0 + HOUR + 5 * MINUTE);
  });

  it('wakes a Cron Monitor at the maximum runtime once a run starts', () => {
    const started = advance(cron, { status: 'in_progress', at: T0 + HOUR }, T0 + HOUR);
    if (started === null) throw new Error('the check-in moved nothing');
    expect(nextAlarmAt(started.state, T0 + HOUR)).toBe(T0 + HOUR + 30 * MINUTE);
  });

  it('wakes an Uptime Monitor one Uptime interval from now', () => {
    expect(nextAlarmAt(uptime, T0 + 7)).toBe(T0 + 7 + MINUTE);
  });

  it('a Cron Monitor ticked at its alarm always moves on to a later alarm', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 3 * HOUR }), { maxLength: 6 }), (gaps) => {
        let monitor: Monitor = cron;
        let now = T0;
        for (const gap of gaps) {
          now += gap;
          const started = advance(monitor, { status: 'in_progress', at: now }, now);
          if (started !== null) monitor = started.state;
        }
        const alarm = Math.max(nextAlarmAt(monitor, now), now);
        const ticked = advance(monitor, null, alarm);
        if (ticked === null) return false;
        return nextAlarmAt(ticked.state, alarm) > alarm;
      }),
    );
  });
});
