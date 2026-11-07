// The core Worker's pure parts: IssuePolicies read from its vars, and the
// reads ProjectDO answers from Events (latest Event, metric value).
import { describe, expect, it } from 'vitest';
import { issuePolicies } from '../../../../src/workers/core/deps.js';
import { latestSummary, metricOf } from '../../../../src/workers/core/project-steps.js';
import type { GroupedEvent } from '../../../../src/domain/issue/tally.js';

const vars = {
  NEW_ISSUE_AGE_MS: 1,
  SETTLE_AGE_MS: 2,
  INBOX_EXPIRY_MS: 3,
  AUTO_RESOLVE_AGE_MS: 0,
  EARLY_ESCALATION_YOUNG_AGE_MS: 4,
  EARLY_ESCALATION_MINIMUM_COUNT: 5,
  EARLY_ESCALATION_RATE_MULTIPLE: 6,
  FORECAST_WINDOW_MS: 7,
  FORECAST_SPREAD_MULTIPLE: 8,
  FORECAST_FLOOR: 9,
  FORECAST_REFRESH_INTERVAL_MS: 10,
} as unknown as CoreEnv;

function event(eventId: string, at: number, userKey: string | null): GroupedEvent {
  return {
    summary: { eventId, at, release: null, environment: null, level: 'error', userKey, title: 't', culprit: null },
    fingerprints: ['fp'],
  };
}

describe('issuePolicies', () => {
  it('reads every policy from its var; an Auto-Resolve Age of 0 means never', () => {
    expect(issuePolicies(vars)).toEqual({
      newIssueAge: 1,
      settleAge: 2,
      inboxExpiry: 3,
      autoResolveAge: null,
      earlyEscalation: { youngAge: 4, minimumCount: 5, rateMultiple: 6 },
      forecast: { window: 7, spreadMultiple: 8, floor: 9, refreshInterval: 10 },
    });
    expect(issuePolicies({ ...vars, AUTO_RESOLVE_AGE_MS: 30 }).autoResolveAge).toBe(30);
  });

  it('refuses a missing or non-positive setting by name', () => {
    expect(() => issuePolicies({ ...vars, SETTLE_AGE_MS: 0 })).toThrow(/SETTLE_AGE_MS/);
    expect(() => issuePolicies({ ...vars, FORECAST_FLOOR: Number.NaN })).toThrow(/FORECAST_FLOOR/);
  });
});

describe('latestSummary', () => {
  it('is the latest Event by time, the later recorded on a tie, and null with none', () => {
    expect(latestSummary([])).toBeNull();
    expect(latestSummary([event('a', 5, null), event('b', 9, null), event('c', 7, null)])?.eventId).toBe('b');
    expect(latestSummary([event('a', 9, null), event('b', 9, null)])?.eventId).toBe('b');
  });
});

describe('metricOf', () => {
  const events = [event('a', 1, 'u1'), event('b', 5, 'u1'), event('c', 6, 'u2'), event('d', 7, null)];

  it('counts Events and distinct named users at or after since; no crash-free rate from Events', () => {
    expect(metricOf({ aggregate: 'event_count', events, since: 5 })).toBe(3);
    expect(metricOf({ aggregate: 'user_count', events, since: 0 })).toBe(2);
    expect(metricOf({ aggregate: 'crash_free_rate', events, since: 0 })).toBeNull();
  });
});
