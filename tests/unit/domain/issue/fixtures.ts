// Issue fixtures: policies and states as plain values for the issue domain tests.
import fc from 'fast-check';
import type { IssuePolicies } from '../../../../src/domain/issue/policies.js';
import type { IssueState, IssueStateBase, Status } from '../../../../src/domain/issue/state.js';
import type { EventFacts } from '../../../../src/domain/issue/event.js';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const T0 = Date.UTC(2026, 10, 1);

export const policies: IssuePolicies = {
  newIssueAge: 3 * DAY,
  settleAge: 7 * DAY,
  inboxExpiry: 7 * DAY,
  autoResolveAge: null,
  earlyEscalation: { youngAge: 1 * DAY, minimumCount: 10, rateMultiple: 5 },
  forecast: { window: 24 * HOUR, spreadMultiple: 3, floor: 10, refreshInterval: HOUR },
};

export const member = { member: 'member-1' } as const;

/** An Issue first seen at T0, seen once, medium Priority, not in For Review, in the given Status. */
export function issueIn(status: Status, overrides: Partial<IssueStateBase> = {}): IssueState {
  return {
    issueId: 'issue-1',
    substatusSince: T0,
    firstSeen: T0,
    lastSeen: T0,
    count: 1,
    userCount: 1,
    priority: { level: 'medium', setByHand: false },
    forReviewSince: null,
    ...overrides,
    ...status,
  };
}

export function eventAt(at: number, overrides: Partial<EventFacts> = {}): EventFacts {
  return {
    at,
    release: null,
    isNewUser: false,
    hourlyCount: 1,
    projectNormalRate: 1,
    conditionWindowCount: null,
    conditionWindowUserCount: null,
    ...overrides,
  };
}

// --- arbitraries ---

const time = fc.integer({ min: T0, max: T0 + 30 * DAY });

export const statusArbitrary: fc.Arbitrary<Status> = fc.oneof(
  fc.constantFrom('new', 'ongoing', 'escalating', 'regressed').map((substatus) => ({ status: 'unresolved', substatus }) as const),
  fc.constantFrom<Status>(
    { status: 'resolved', resolution: { kind: 'plain' } },
    { status: 'resolved', resolution: { kind: 'in_release', release: '1.0.0' } },
    { status: 'resolved', resolution: { kind: 'in_next_release', release: null } },
    { status: 'resolved', resolution: { kind: 'in_commit', commit: 'abc', release: null } },
    { status: 'archived', substatus: 'until_escalating' },
    { status: 'archived', substatus: 'forever', spam: false },
    { status: 'deleting' },
    { status: 'merging' },
  ),
  fc.record({ untilDate: fc.option(time, { nil: null }), count: fc.option(fc.integer({ min: 1, max: 50 }), { nil: null }) }).map(
    ({ untilDate, count }) =>
      ({
        status: 'archived',
        substatus: 'until_condition',
        condition: { untilDate, count, window: null, userCount: null, userWindow: null, baselineCount: 1, baselineUserCount: 1 },
      }) as const,
  ),
);

export const issueArbitrary: fc.Arbitrary<IssueState> = fc
  .record({
    status: statusArbitrary,
    since: time,
    seen: time,
    count: fc.integer({ min: 1, max: 1000 }),
    level: fc.constantFrom('low', 'medium', 'high'),
    setByHand: fc.boolean(),
    review: fc.option(time, { nil: null }),
  })
  .map(({ status, since, seen, count, level, setByHand, review }) =>
    issueIn(status, {
      substatusSince: since,
      firstSeen: Math.min(since, seen),
      lastSeen: Math.max(since, seen),
      count,
      priority: { level, setByHand },
      forReviewSince: review,
    }),
  );

export const eventArbitrary: fc.Arbitrary<EventFacts> = fc.record({
  at: time,
  release: fc.option(fc.constantFrom('0.9.0', '1.0.0', '1.1.0'), { nil: null }),
  isNewUser: fc.boolean(),
  hourlyCount: fc.nat(500),
  projectNormalRate: fc.nat(50),
  conditionWindowCount: fc.option(fc.nat(100), { nil: null }),
  conditionWindowUserCount: fc.option(fc.nat(100), { nil: null }),
});
