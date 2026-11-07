import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  closeIncident,
  closedIncident,
  metricAlertRule,
  stepIncident,
  type IncidentChange,
  type IncidentState,
  type MetricAlertRule,
} from '../../../../src/domain/alerts/metric-incident.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { HOUR, MINUTE, T0 } from '../issue/fixtures.js';

const eventCountRule: MetricAlertRule = {
  ruleId: 'metric-1',
  aggregate: 'event_count',
  windowMs: 10 * MINUTE,
  comparison: 'above',
  critical: 100,
  warning: 50,
  resolve: null,
  breachesToOpen: 3,
  recoveriesToClose: 2,
};

/** Steps the rule over the values, one evaluation per minute from T0, keeping every change. */
function run(rule: MetricAlertRule, values: readonly number[], start: IncidentState = closedIncident()) {
  return values.reduce<{ state: IncidentState; changes: readonly (IncidentChange | null)[] }>(
    (acc, value, i) => {
      const step = stepIncident({ rule, state: acc.state, value, at: T0 + i * MINUTE });
      return { state: step.state, changes: [...acc.changes, step.change] };
    },
    { state: start, changes: [] },
  );
}

function levelsOf(changes: readonly (IncidentChange | null)[]): readonly (string | null)[] {
  return changes.map((change) => (change === null ? null : `${change.from}->${change.to}`));
}

describe('Metric Incident', () => {
  it('Metric incident opens and closes: Given a metric rule, When its aggregate breaches for the required consecutive windows, Then an Incident opens; When it recovers for the required windows, Then the Incident closes, and each change notifies', () => {
    const { state, changes } = run(eventCountRule, [150, 150, 150, 10, 10]);
    expect(levelsOf(changes)).toEqual([null, null, 'closed->critical', null, 'critical->closed']);
    expect(changes[2]).toEqual({ ruleId: 'metric-1', from: 'closed', to: 'critical', at: T0 + 2 * MINUTE, value: 150, actor: 'system' });
    expect(state.level).toBe('closed');
  });

  it('a broken run of breaches opens nothing', () => {
    expect(levelsOf(run(eventCountRule, [150, 150, 10, 150, 150]).changes)).toEqual([null, null, null, null, null]);
  });

  it('opens at warning on consecutive breaches of the warning threshold, counting critical values as warning breaches', () => {
    expect(levelsOf(run(eventCountRule, [60, 150, 60]).changes)).toEqual([null, null, 'closed->warning']);
  });

  it('moves warning to critical on consecutive critical breaches, and critical to warning on consecutive values between the thresholds', () => {
    const { changes } = run(eventCountRule, [60, 60, 60, 150, 150, 150, 70, 70, 70]);
    expect(levelsOf(changes).filter((c) => c !== null)).toEqual(['closed->warning', 'warning->critical', 'critical->warning']);
  });

  it('a value between the resolve threshold and the lowest threshold neither breaches nor recovers', () => {
    const rule: MetricAlertRule = { ...eventCountRule, warning: null, resolve: 40 };
    const opened = run(rule, [150, 150, 150]).state;
    expect(levelsOf(run(rule, [80, 80, 80, 30, 30], opened).changes)).toEqual([null, null, null, null, 'critical->closed']);
  });

  it('a rule watching for values below its thresholds breaches when the aggregate falls', () => {
    const rule: MetricAlertRule = {
      ...eventCountRule,
      aggregate: 'crash_free_rate',
      comparison: 'below',
      critical: 0.95,
      warning: 0.99,
      breachesToOpen: 1,
      recoveriesToClose: 1,
    };
    expect(levelsOf(run(rule, [0.999, 0.98, 0.9, 0.999]).changes)).toEqual([
      null,
      'closed->warning',
      'warning->critical',
      'critical->closed',
    ]);
  });

  it('a member closes an open Incident at once', () => {
    const opened = run(eventCountRule, [150, 150, 150]).state;
    const closed = closeIncident({ rule: eventCountRule, state: opened, member: { member: 'm1' }, at: T0 + HOUR });
    expect(closed.change).toEqual({
      ruleId: 'metric-1',
      from: 'critical',
      to: 'closed',
      at: T0 + HOUR,
      value: null,
      actor: { member: 'm1' },
    });
    expect(closed.state.level).toBe('closed');
    expect(closeIncident({ rule: eventCountRule, state: closed.state, member: { member: 'm1' }, at: T0 + HOUR }).change).toBeNull();
  });

  it('never opens with fewer than the required consecutive breaches', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.array(fc.integer({ min: 0, max: 200 }), { maxLength: 40 }),
        (breachesToOpen, values) => {
          const rule = { ...eventCountRule, breachesToOpen };
          run(rule, values).changes.forEach((change, i) => {
            if (change === null || change.from !== 'closed') return;
            const recent = values.slice(i + 1 - breachesToOpen, i + 1);
            expect(i + 1).toBeGreaterThanOrEqual(breachesToOpen);
            expect(recent.every((value) => value > (rule.warning ?? rule.critical))).toBe(true);
          });
        },
      ),
    );
  });

  it('never closes with fewer than the required consecutive recoveries', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.array(fc.integer({ min: 0, max: 200 }), { maxLength: 40 }),
        (recoveriesToClose, values) => {
          const rule = { ...eventCountRule, breachesToOpen: 1, recoveriesToClose };
          run(rule, values).changes.forEach((change, i) => {
            if (change === null || change.to !== 'closed') return;
            expect(values.slice(Math.max(0, i + 1 - recoveriesToClose), i + 1).every((value) => value <= 50)).toBe(true);
            expect(i + 1).toBeGreaterThan(recoveriesToClose);
          });
        },
      ),
    );
  });

  it('refuses a rule whose counts are below one or whose thresholds are out of order', () => {
    expect(metricAlertRule(eventCountRule)).toEqual(eventCountRule);
    expect(isRefusal(metricAlertRule({ ...eventCountRule, breachesToOpen: 0 }))).toBe(true);
    expect(isRefusal(metricAlertRule({ ...eventCountRule, recoveriesToClose: 0 }))).toBe(true);
    expect(isRefusal(metricAlertRule({ ...eventCountRule, warning: 120 }))).toBe(true);
    expect(isRefusal(metricAlertRule({ ...eventCountRule, resolve: 60 }))).toBe(true);
    expect(isRefusal(metricAlertRule({ ...eventCountRule, comparison: 'below' }))).toBe(true);
    expect(isRefusal(metricAlertRule({ ...eventCountRule, windowMs: 0 }))).toBe(true);
  });
});
