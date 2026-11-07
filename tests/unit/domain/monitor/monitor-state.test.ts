import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  INITIAL_MONITOR_COUNTS,
  parseMonitorThresholds,
  recordFailure,
  recordSuccess,
  type MonitorChange,
  type MonitorCounts,
  type MonitorThresholds,
} from '../../../../src/domain/monitor/monitor-state.js';

const thresholds: MonitorThresholds = { failureThreshold: 3, recoveryThreshold: 2 };

type Result = 'failure' | 'success';

function replay(results: readonly Result[], limits: MonitorThresholds): { counts: MonitorCounts; changes: MonitorChange[] } {
  let counts = INITIAL_MONITOR_COUNTS;
  const changes: MonitorChange[] = [];
  results.forEach((result, index) => {
    const step = result === 'failure' ? recordFailure(counts, limits, index) : recordSuccess(counts, limits, index);
    counts = step.counts;
    if (step.change) changes.push(step.change);
  });
  return { counts, changes };
}

describe('parseMonitorThresholds', () => {
  it('accepts whole thresholds of at least one and refuses others', () => {
    expect(parseMonitorThresholds({ failureThreshold: 1, recoveryThreshold: 4 })).toEqual({ failureThreshold: 1, recoveryThreshold: 4 });
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(parseMonitorThresholds({ failureThreshold: bad, recoveryThreshold: 1 })).toEqual({ refusal: 'invalid-monitor-threshold' });
      expect(parseMonitorThresholds({ failureThreshold: 1, recoveryThreshold: bad })).toEqual({ refusal: 'invalid-monitor-threshold' });
    }
  });
});

describe('Cron and Uptime Monitor state machine', () => {
  it('OK -> Failing: a Failure recorded with the count below the threshold', () => {
    const { counts, changes } = replay(['failure'], thresholds);
    expect(counts).toEqual({ status: 'failing', consecutiveFailures: 1, consecutiveSuccesses: 0 });
    expect(changes).toEqual([]);
  });

  it('Monitor issue opens and resolves: Given consecutive Failures past the threshold, When the last is recorded, Then a monitor issue opens; When consecutive successes pass the recovery threshold, Then it resolves', () => {
    const opened = replay(['failure', 'failure', 'failure'], thresholds);
    expect(opened.counts.status).toBe('incident');
    expect(opened.changes).toEqual([{ kind: 'issue-opened', at: 2 }]);

    const resolved = replay(['failure', 'failure', 'failure', 'success', 'success'], thresholds);
    expect(resolved.counts).toEqual({ status: 'ok', consecutiveFailures: 0, consecutiveSuccesses: 2 });
    expect(resolved.changes).toEqual([
      { kind: 'issue-opened', at: 2 },
      { kind: 'issue-resolved', at: 4 },
    ]);
  });

  it('Incident -> Recovering: a success recorded with the count below the recovery threshold', () => {
    const { counts, changes } = replay(['failure', 'failure', 'failure', 'success'], thresholds);
    expect(counts).toEqual({ status: 'recovering', consecutiveFailures: 0, consecutiveSuccesses: 1 });
    expect(changes).toHaveLength(1);
  });

  it('Failing -> OK: the run of Failures breaks on a success, and no issue opens', () => {
    const { counts, changes } = replay(['failure', 'failure', 'success', 'failure', 'failure'], thresholds);
    expect(counts).toEqual({ status: 'failing', consecutiveFailures: 2, consecutiveSuccesses: 0 });
    expect(replay(['failure', 'failure', 'success'], thresholds).counts.status).toBe('ok');
    expect(changes).toEqual([]);
  });

  it('Recovering -> Incident: the run of successes breaks on a Failure, and the issue stays open', () => {
    const { counts, changes } = replay(['failure', 'failure', 'failure', 'success', 'failure', 'success'], thresholds);
    expect(replay(['failure', 'failure', 'failure', 'success', 'failure'], thresholds).counts.status).toBe('incident');
    expect(counts).toEqual({ status: 'recovering', consecutiveFailures: 0, consecutiveSuccesses: 1 });
    expect(changes).toEqual([{ kind: 'issue-opened', at: 2 }]);
  });

  it('opens on the first Failure and resolves on the first success when the thresholds are one', () => {
    const { changes } = replay(['failure', 'success'], { failureThreshold: 1, recoveryThreshold: 1 });
    expect(changes).toEqual([
      { kind: 'issue-opened', at: 0 },
      { kind: 'issue-resolved', at: 1 },
    ]);
  });

  it('opens and resolves alternately, opening only after a run of Failures reaching the threshold (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Result>('failure', 'success'), { maxLength: 60 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        (results, failureThreshold, recoveryThreshold) => {
          const limits = { failureThreshold, recoveryThreshold };
          const { counts, changes } = replay(results, limits);
          changes.forEach((change, index) => {
            expect(change.kind).toBe(index % 2 === 0 ? 'issue-opened' : 'issue-resolved');
            const run = change.kind === 'issue-opened' ? failureThreshold : recoveryThreshold;
            const expected: Result = change.kind === 'issue-opened' ? 'failure' : 'success';
            expect(results.slice(change.at + 1 - run, change.at + 1)).toEqual(Array<Result>(run).fill(expected));
          });
          const open = changes.length % 2 === 1;
          expect(open).toBe(counts.status === 'incident' || counts.status === 'recovering');
        },
      ),
    );
  });
});
