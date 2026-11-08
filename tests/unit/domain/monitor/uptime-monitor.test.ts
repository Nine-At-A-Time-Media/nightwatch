import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  NEW_UPTIME_MONITOR,
  onProbe,
  parseUptimeMonitorConfig,
  type ProbeResult,
  type UptimeMonitorConfig,
  type UptimeMonitorState,
} from '../../../../src/domain/monitor/uptime-monitor.js';
import { isRefusal } from '../../../../src/domain/refusal.js';

const config: UptimeMonitorConfig = { uptimeFailureCount: 3, recoveryCount: 2 };

function down(at: number): ProbeResult {
  return { status: 'down', reason: 'status 503', at };
}

function up(at: number): ProbeResult {
  return { status: 'up', reason: null, at };
}

function probeAll(results: readonly ProbeResult[], cfg: UptimeMonitorConfig = config) {
  let state: UptimeMonitorState = NEW_UPTIME_MONITOR;
  const steps = results.map((result) => {
    const step = onProbe(state, result, cfg);
    state = step.state;
    return step;
  });
  return { state, steps };
}

describe('parseUptimeMonitorConfig', () => {
  it('refuses an Uptime Failure Count or recovery count under one', () => {
    expect(parseUptimeMonitorConfig({ uptimeFailureCount: 1, recoveryCount: 1 })).toEqual({ uptimeFailureCount: 1, recoveryCount: 1 });
    expect(isRefusal(parseUptimeMonitorConfig({ uptimeFailureCount: 0, recoveryCount: 1 }))).toBe(true);
    expect(isRefusal(parseUptimeMonitorConfig({ uptimeFailureCount: 1, recoveryCount: 2.5 }))).toBe(true);
  });
});

describe('onProbe', () => {
  it('URL down: Given an Uptime Monitor, When checks fail past the Uptime Failure Count, Then a monitor issue opens', () => {
    const { state, steps } = probeAll([down(1), down(2), down(3)]);
    expect(steps.map((step) => step.change)).toEqual([null, null, { kind: 'issue-opened', at: 3 }]);
    expect(steps[0]?.failures).toEqual([]);
    expect(steps[1]?.failures).toEqual([]);
    expect(steps[2]?.failures).toEqual([{ kind: 'down', at: 3, reason: 'status 503' }]);
    expect(state.counts.status).toBe('incident');
  });

  it('starts the count again when a check succeeds before the Uptime Failure Count', () => {
    const { state, steps } = probeAll([down(1), down(2), up(3), down(4), down(5)]);
    expect(steps.flatMap((step) => step.failures)).toEqual([]);
    expect(state.counts.status).toBe('failing');
  });

  it('records each further failed check as a down Failure while the issue is open, and resolves after the recovery count', () => {
    const { state, steps } = probeAll([down(1), down(2), down(3), down(4), up(5), up(6)]);
    expect(steps[3]?.failures).toEqual([{ kind: 'down', at: 4, reason: 'status 503' }]);
    expect(steps[4]?.change).toBeNull();
    expect(steps[5]?.change).toEqual({ kind: 'issue-resolved', at: 6 });
    expect(state.counts.status).toBe('ok');
  });

  it('records a down Failure exactly when the failed run reaches the Uptime Failure Count (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 50 }), fc.integer({ min: 1, max: 4 }), (isUp, uptimeFailureCount) => {
        const cfg = { uptimeFailureCount, recoveryCount: 1 };
        const results = isUp.map((value, index) => (value ? up(index) : down(index)));
        const { steps } = probeAll(results, cfg);
        let run = 0;
        steps.forEach((step, index) => {
          run = isUp[index] ? 0 : run + 1;
          expect(step.failures.length).toBe(run >= uptimeFailureCount ? 1 : 0);
        });
      }),
    );
  });
});
