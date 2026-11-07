import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  newCronMonitor,
  onCheckIn,
  onTick,
  parseCronMonitorConfig,
  type CronMonitorConfig,
  type CronMonitorState,
} from '../../../../src/domain/monitor/cron-monitor.js';
import { parseSchedule, type Schedule } from '../../../../src/domain/monitor/schedule.js';
import { isRefusal } from '../../../../src/domain/refusal.js';

const MINUTE = 60_000;

function hourly(): Schedule {
  const schedule = parseSchedule({ kind: 'crontab', expression: '0 * * * *', timezone: 'UTC' });
  if (isRefusal(schedule)) throw new Error('fixture refused');
  return schedule;
}

function config(overrides: Partial<Omit<CronMonitorConfig, 'schedule'>> = {}): CronMonitorConfig {
  const parsed = parseCronMonitorConfig({
    schedule: hourly(),
    margin: 5 * MINUTE,
    maxRuntime: 30 * MINUTE,
    thresholds: { failureThreshold: 2, recoveryThreshold: 1 },
    ...overrides,
  });
  if (isRefusal(parsed)) throw new Error('fixture refused');
  return parsed;
}

function at(iso: string): number {
  return Date.parse(iso);
}

/** A monitor created at 09:30, so its first expected run is 10:00. */
function fresh(cfg: CronMonitorConfig = config()): CronMonitorState {
  return newCronMonitor(cfg, at('2026-11-07T09:30:00Z'));
}

describe('parseCronMonitorConfig', () => {
  it('refuses a negative margin, a maximum runtime under a millisecond, or a threshold under one', () => {
    const base = { schedule: hourly(), margin: 0, maxRuntime: 1, thresholds: { failureThreshold: 1, recoveryThreshold: 1 } };
    expect(isRefusal(parseCronMonitorConfig(base))).toBe(false);
    expect(parseCronMonitorConfig({ ...base, margin: -1 })).toEqual({ refusal: 'invalid-monitor-config' });
    expect(parseCronMonitorConfig({ ...base, maxRuntime: 0 })).toEqual({ refusal: 'invalid-monitor-config' });
    expect(parseCronMonitorConfig({ ...base, thresholds: { failureThreshold: 0, recoveryThreshold: 1 } })).toEqual({
      refusal: 'invalid-monitor-threshold',
    });
  });
});

describe('newCronMonitor', () => {
  it('expects the first run the schedule names after its creation, in state OK', () => {
    expect(fresh()).toEqual({
      expectedAt: at('2026-11-07T10:00:00Z'),
      run: null,
      counts: { status: 'ok', consecutiveFailures: 0, consecutiveSuccesses: 0 },
    });
  });
});

describe('onTick', () => {
  it('Missed check-in: Given a Cron Monitor, When no check-in arrives by its expected time plus margin, Then a missed Failure is recorded', () => {
    const before = onTick(fresh(), at('2026-11-07T10:04:59Z'), config());
    expect(before.failures).toEqual([]);

    const step = onTick(fresh(), at('2026-11-07T10:05:00Z'), config());
    expect(step.failures).toEqual([{ kind: 'missed', at: at('2026-11-07T10:05:00Z'), reason: null }]);
    expect(step.state.expectedAt).toBe(at('2026-11-07T11:00:00Z'));
    expect(step.state.counts.status).toBe('failing');
    expect(step.change).toBeNull();
  });

  it('records a missed Failure once per expected run, and opens the monitor issue at the threshold', () => {
    const step = onTick(fresh(), at('2026-11-07T12:04:00Z'), config());
    expect(step.failures.map((failure) => failure.at)).toEqual([at('2026-11-07T10:05:00Z'), at('2026-11-07T11:05:00Z')]);
    expect(step.change).toEqual({ kind: 'issue-opened', at: at('2026-11-07T11:05:00Z') });
    expect(step.state.expectedAt).toBe(at('2026-11-07T12:00:00Z'));

    const again = onTick(step.state, at('2026-11-07T12:04:00Z'), config());
    expect(again.failures).toEqual([]);
    expect(again.change).toBeNull();
  });

  it('Overlong run: Given a run in progress, When it exceeds its maximum runtime, Then a timeout Failure is recorded', () => {
    const started = onCheckIn(fresh(), { status: 'in_progress', at: at('2026-11-07T10:00:10Z') }, config()).state;
    expect(started.run).toEqual({ startedAt: at('2026-11-07T10:00:10Z'), late: false });

    expect(onTick(started, at('2026-11-07T10:30:09Z'), config()).failures).toEqual([]);
    const step = onTick(started, at('2026-11-07T10:30:10Z'), config());
    expect(step.failures).toEqual([{ kind: 'timeout', at: at('2026-11-07T10:30:10Z'), reason: null }]);
    expect(step.state.run).toBeNull();
    expect(step.state.expectedAt).toBe(at('2026-11-07T11:00:00Z'));
  });

  it('records no missed Failure for a slot that passes while a run is in progress', () => {
    const cfg = config({ maxRuntime: 120 * MINUTE });
    const started = onCheckIn(fresh(cfg), { status: 'in_progress', at: at('2026-11-07T10:00:00Z') }, cfg).state;
    expect(onTick(started, at('2026-11-07T11:30:00Z'), cfg).failures).toEqual([]);

    const ended = onCheckIn(started, { status: 'ok', at: at('2026-11-07T11:30:00Z') }, cfg);
    expect(ended.failures).toEqual([]);
    expect(ended.state.expectedAt).toBe(at('2026-11-07T12:00:00Z'));
  });
});

describe('onCheckIn', () => {
  it('counts an on-time ok check-in as a success and expects the next run', () => {
    const step = onCheckIn(fresh(), { status: 'ok', at: at('2026-11-07T10:01:00Z') }, config());
    expect(step.failures).toEqual([]);
    expect(step.state.counts).toEqual({ status: 'ok', consecutiveFailures: 0, consecutiveSuccesses: 1 });
    expect(step.state.expectedAt).toBe(at('2026-11-07T11:00:00Z'));
  });

  it('records an error check-in as a failed run', () => {
    const step = onCheckIn(fresh(), { status: 'error', at: at('2026-11-07T10:01:00Z') }, config());
    expect(step.failures).toEqual([{ kind: 'error', at: at('2026-11-07T10:01:00Z'), reason: null }]);
  });

  it('records the result of a run when it ends, measured from its start', () => {
    const started = onCheckIn(fresh(), { status: 'in_progress', at: at('2026-11-07T10:00:00Z') }, config());
    expect(started.failures).toEqual([]);
    expect(started.state.counts.consecutiveSuccesses).toBe(0);
    const failed = onCheckIn(started.state, { status: 'error', at: at('2026-11-07T10:10:00Z') }, config());
    expect(failed.failures).toEqual([{ kind: 'error', at: at('2026-11-07T10:10:00Z'), reason: null }]);
    expect(failed.state.run).toBeNull();
  });

  it('records a check-in after the expected time plus margin as late, and earlier unclaimed runs as missed', () => {
    const late = onCheckIn(fresh(), { status: 'ok', at: at('2026-11-07T10:20:00Z') }, config());
    expect(late.failures).toEqual([{ kind: 'late', at: at('2026-11-07T10:20:00Z'), reason: null }]);
    expect(late.state.expectedAt).toBe(at('2026-11-07T11:00:00Z'));

    const later = onCheckIn(fresh(), { status: 'ok', at: at('2026-11-07T11:10:00Z') }, config());
    expect(later.failures.map((failure) => failure.kind)).toEqual(['missed', 'late']);
    expect(later.change).toEqual({ kind: 'issue-opened', at: at('2026-11-07T11:10:00Z') });
  });

  it('records a late run once: its start is the Failure, its ok end adds nothing', () => {
    const started = onCheckIn(fresh(), { status: 'in_progress', at: at('2026-11-07T10:20:00Z') }, config());
    expect(started.failures.map((failure) => failure.kind)).toEqual(['late']);
    const ended = onCheckIn(started.state, { status: 'ok', at: at('2026-11-07T10:25:00Z') }, config());
    expect(ended.failures).toEqual([]);
    expect(ended.state.counts.consecutiveSuccesses).toBe(0);
  });

  it('ends an overlong run whose end arrives before the tick with a timeout Failure, not a success', () => {
    const started = onCheckIn(fresh(), { status: 'in_progress', at: at('2026-11-07T10:00:00Z') }, config()).state;
    const step = onCheckIn(started, { status: 'ok', at: at('2026-11-07T10:45:00Z') }, config());
    expect(step.failures).toEqual([{ kind: 'timeout', at: at('2026-11-07T10:30:00Z'), reason: null }]);
    expect(step.state.run).toBeNull();

    const muchLater = onCheckIn(started, { status: 'ok', at: at('2026-11-07T11:10:00Z') }, config());
    expect(muchLater.failures.map((failure) => failure.kind)).toEqual(['timeout', 'missed']);
    expect(muchLater.state.expectedAt).toBe(at('2026-11-07T12:00:00Z'));
  });

  it('resolves the monitor issue on a success past the recovery threshold', () => {
    const opened = onTick(fresh(), at('2026-11-07T11:30:00Z'), config());
    expect(opened.change?.kind).toBe('issue-opened');
    const resolved = onCheckIn(opened.state, { status: 'ok', at: at('2026-11-07T12:00:30Z') }, config());
    expect(resolved.change).toEqual({ kind: 'issue-resolved', at: at('2026-11-07T12:00:30Z') });
    expect(resolved.state.counts.status).toBe('ok');
  });

  it('never records a success and a Failure in one step, and leaves no deadline behind it (property)', () => {
    const statuses = fc.constantFrom('in_progress' as const, 'ok' as const, 'error' as const);
    const event = fc.record({ checkIn: fc.option(statuses, { nil: null }), gap: fc.integer({ min: 0, max: 3 * 60 * MINUTE }) });
    fc.assert(
      fc.property(fc.array(event, { maxLength: 30 }), (events) => {
        const cfg = config();
        let state = fresh(cfg);
        let now = at('2026-11-07T09:30:00Z');
        for (const { checkIn, gap } of events) {
          now += gap;
          const before = state.counts;
          const step = checkIn === null ? onTick(state, now, cfg) : onCheckIn(state, { status: checkIn, at: now }, cfg);
          if (step.failures.length > 0) {
            expect(step.state.counts.consecutiveFailures).toBe(before.consecutiveFailures + step.failures.length);
          }
          if (step.state.run === null) expect(step.state.expectedAt + cfg.margin).toBeGreaterThan(now);
          state = step.state;
        }
      }),
    );
  });
});
