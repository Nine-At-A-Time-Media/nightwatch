import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyEvent, createIssue, type EventContext } from '../../../../src/domain/issue/event.js';
import type { IssueState, SnoozeCondition } from '../../../../src/domain/issue/state.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { DAY, HOUR, T0, eventAt, eventArbitrary, issueArbitrary, issueIn, policies } from './fixtures.js';

const context: EventContext = { policies, forecast: { ceiling: 20 }, firstSeen: new Map() };
const noCondition: SnoozeCondition = {
  untilDate: null,
  count: null,
  window: null,
  userCount: null,
  userWindow: null,
  baselineCount: 1,
  baselineUserCount: 1,
};

function applied(state: IssueState, ...args: Parameters<typeof eventAt>) {
  const result = applyEvent(state, eventAt(...args), context);
  if (isRefusal(result)) throw new Error(result.refusal);
  return result;
}

describe('createIssue', () => {
  it('a first event opens an Unresolved/New issue in For Review, its Priority following the event level', () => {
    const { state, changes } = createIssue({ issueId: 'issue-9', at: T0, level: 'error', isNewUser: true });
    expect(state).toMatchObject({
      status: 'unresolved',
      substatus: 'new',
      count: 1,
      userCount: 1,
      firstSeen: T0,
      lastSeen: T0,
      substatusSince: T0,
      forReviewSince: T0,
      priority: { level: 'high', setByHand: false },
    });
    expect(changes).toContainEqual({
      issueId: 'issue-9',
      kind: 'status',
      from: null,
      to: 'unresolved/new',
      actor: 'system',
      origin: 'nightwatch',
      at: T0,
    });
  });

  it('a warning opens at medium Priority and an info message at low', () => {
    expect(createIssue({ issueId: 'i', at: T0, level: 'warning', isNewUser: false }).state.priority.level).toBe('medium');
    expect(createIssue({ issueId: 'i', at: T0, level: 'info', isNewUser: false }).state).toMatchObject({
      priority: { level: 'low' },
      userCount: 0,
    });
  });
});

describe('applyEvent', () => {
  it('counts the event, its new user, and moves last seen', () => {
    const { state, changes } = applied(issueIn({ status: 'unresolved', substatus: 'ongoing' }), T0 + HOUR, { isNewUser: true });
    expect(state).toMatchObject({ count: 2, userCount: 2, lastSeen: T0 + HOUR, status: 'unresolved', substatus: 'ongoing' });
    expect(changes).toEqual([]);
  });

  it('Early escalation: Given a young issue that is frequent and well above its project normal rate, When another event arrives, Then it becomes Escalating and its Priority rises', () => {
    const young = issueIn({ status: 'unresolved', substatus: 'new' }, { count: 9 });
    const { state, changes } = applied(young, T0 + HOUR, { hourlyCount: 50, projectNormalRate: 10 });
    expect(state).toMatchObject({
      status: 'unresolved',
      substatus: 'escalating',
      substatusSince: T0 + HOUR,
      priority: { level: 'high', setByHand: false },
      forReviewSince: T0 + HOUR,
    });
    expect(changes.map((c) => [c.kind, c.from, c.to])).toEqual([
      ['status', 'unresolved/new', 'unresolved/escalating'],
      ['priority', 'medium', 'high'],
      ['for_review', null, 'in'],
    ]);
  });

  it('Early escalation does not hold for an issue past its young age, below the minimum count, or near its project normal rate', () => {
    const young = issueIn({ status: 'unresolved', substatus: 'new' }, { count: 9 });
    expect(applied(young, T0 + 2 * DAY, { hourlyCount: 50, projectNormalRate: 10 }).state).toMatchObject({ substatus: 'new' });
    expect(applied({ ...young, count: 1 }, T0 + HOUR, { hourlyCount: 50, projectNormalRate: 10 }).state).toMatchObject({
      substatus: 'new',
    });
    expect(applied(young, T0 + HOUR, { hourlyCount: 49, projectNormalRate: 10 }).state).toMatchObject({ substatus: 'new' });
  });

  it('Early escalation applies only within the New state', () => {
    const ongoing = issueIn({ status: 'unresolved', substatus: 'ongoing' }, { count: 9 });
    expect(applied(ongoing, T0 + HOUR, { hourlyCount: 500, projectNormalRate: 1 }).state).toMatchObject({ substatus: 'ongoing' });
  });

  it('Hand-set priority sticks: Given a member set an issue Priority, When the issue escalates, Then its Priority does not change', () => {
    const handSet = { level: 'low', setByHand: true } as const;
    const young = issueIn({ status: 'unresolved', substatus: 'new' }, { count: 9, priority: handSet });
    const early = applied(young, T0 + HOUR, { hourlyCount: 50, projectNormalRate: 10 });
    expect(early.state).toMatchObject({ substatus: 'escalating', priority: handSet });
    expect(early.changes.map((c) => c.kind)).not.toContain('priority');

    const snoozed = issueIn({ status: 'archived', substatus: 'until_escalating' }, { priority: handSet });
    expect(applied(snoozed, T0 + HOUR, { hourlyCount: 21 }).state).toMatchObject({ substatus: 'escalating', priority: handSet });
  });

  it('Archived until escalating: Given an issue archived until escalating, When its hourly rate exceeds its Forecast, Then it becomes Escalating and enters For Review', () => {
    const snoozed = issueIn({ status: 'archived', substatus: 'until_escalating' });
    const { state, changes } = applied(snoozed, T0 + HOUR, { hourlyCount: 21 });
    expect(state).toMatchObject({ status: 'unresolved', substatus: 'escalating', forReviewSince: T0 + HOUR, priority: { level: 'high' } });
    expect(changes[0]).toMatchObject({ kind: 'status', from: 'archived/until_escalating', to: 'unresolved/escalating', actor: 'system' });
  });

  it('Archived until escalating stays archived at or under its Forecast, or with no Forecast yet', () => {
    const snoozed = issueIn({ status: 'archived', substatus: 'until_escalating' });
    expect(applied(snoozed, T0 + HOUR, { hourlyCount: 20 }).state.status).toBe('archived');
    const result = applyEvent(snoozed, eventAt(T0 + HOUR, { hourlyCount: 1000 }), { ...context, forecast: null });
    expect(!isRefusal(result) && result.state.status).toBe('archived');
  });

  it('Archived until condition: Given an issue archived until a count, When the count is met, Then it becomes Ongoing', () => {
    const snoozed = issueIn({ status: 'archived', substatus: 'until_condition', condition: { ...noCondition, count: 3 } }, { count: 2 });
    // Baseline 1: the third event since archiving (count 4) meets it.
    expect(applied(snoozed, T0 + HOUR).state.status).toBe('archived');
    const { state, changes } = applied({ ...snoozed, count: 3 }, T0 + HOUR);
    expect(state).toMatchObject({ status: 'unresolved', substatus: 'ongoing', forReviewSince: T0 + HOUR });
    expect(changes[0]).toMatchObject({ from: 'archived/until_condition', to: 'unresolved/ongoing' });
  });

  it('Archived until condition: Given an issue archived until a user count, When the user count is met, Then it becomes Ongoing', () => {
    const snoozed = issueIn({ status: 'archived', substatus: 'until_condition', condition: { ...noCondition, userCount: 2 } });
    expect(applied(snoozed, T0 + HOUR, { isNewUser: false }).state.status).toBe('archived');
    expect(applied({ ...snoozed, userCount: 2 }, T0 + HOUR, { isNewUser: true }).state).toMatchObject({ substatus: 'ongoing' });
  });

  it('Archived until condition: Given an issue archived until a date, When an event arrives after it, Then it becomes Ongoing', () => {
    const snoozed = issueIn({ status: 'archived', substatus: 'until_condition', condition: { ...noCondition, untilDate: T0 + DAY } });
    expect(applied(snoozed, T0 + HOUR).state.status).toBe('archived');
    expect(applied(snoozed, T0 + DAY).state).toMatchObject({ substatus: 'ongoing' });
  });

  it('Archived until condition counts within a window from the counts measured over it', () => {
    const condition = { ...noCondition, count: 5, window: HOUR, userCount: null };
    const snoozed = issueIn({ status: 'archived', substatus: 'until_condition', condition }, { count: 100 });
    expect(applied(snoozed, T0 + HOUR, { conditionWindowCount: 4 }).state.status).toBe('archived');
    expect(applied(snoozed, T0 + HOUR, { conditionWindowCount: 5 }).state).toMatchObject({ substatus: 'ongoing' });
    const users = issueIn({
      status: 'archived',
      substatus: 'until_condition',
      condition: { ...noCondition, userCount: 2, userWindow: HOUR },
    });
    expect(applied(users, T0 + HOUR, { conditionWindowUserCount: 2 }).state).toMatchObject({ substatus: 'ongoing' });
  });

  it('Archived forever stays: Given an issue archived forever, When events arrive, Then it stays archived and counts rise', () => {
    const forever = issueIn({ status: 'archived', substatus: 'forever', spam: false });
    const { state, changes } = applied(forever, T0 + HOUR, { hourlyCount: 10_000, isNewUser: true, release: '9.0.0' });
    expect(state).toMatchObject({ status: 'archived', substatus: 'forever', count: 2, userCount: 2 });
    expect(changes).toEqual([]);
  });

  it('Regression in newer release: Given an issue resolved in release R, When an event from a release newer than R arrives, Then it becomes Regressed', () => {
    const resolved = issueIn({ status: 'resolved', resolution: { kind: 'in_release', release: '1.2.0' } });
    const { state, changes } = applied(resolved, T0 + HOUR, { release: '1.3.0' });
    expect(state).toMatchObject({ status: 'unresolved', substatus: 'regressed', substatusSince: T0 + HOUR, forReviewSince: T0 + HOUR });
    expect(changes[0]).toMatchObject({
      kind: 'status',
      from: 'resolved',
      to: 'unresolved/regressed',
      actor: 'system',
      origin: 'nightwatch',
    });
  });

  it('No regression from older release: Given an issue resolved in release R, When an event from a release older than R arrives, Then it stays resolved', () => {
    const resolved = issueIn({ status: 'resolved', resolution: { kind: 'in_release', release: '1.2.0' } });
    const { state, changes } = applied(resolved, T0 + HOUR, { release: '1.1.9' });
    expect(state).toMatchObject({ status: 'resolved', count: 2 });
    expect(changes).toEqual([]);
  });

  it('refuses an event for an issue being deleted or merged', () => {
    expect(applyEvent(issueIn({ status: 'deleting' }), eventAt(T0), context)).toEqual({ refusal: 'issue_deleting' });
    expect(applyEvent(issueIn({ status: 'merging' }), eventAt(T0), context)).toEqual({ refusal: 'issue_merging' });
  });

  it('never decreases the count, and raises it by exactly one', () => {
    fc.assert(
      fc.property(issueArbitrary, eventArbitrary, (state, event) => {
        const result = applyEvent(state, event, context);
        if (isRefusal(result)) return;
        expect(result.state.count).toBe(state.count + 1);
        expect(result.state.lastSeen).toBeGreaterThanOrEqual(state.lastSeen);
      }),
    );
  });

  it('never changes a hand-set Priority', () => {
    fc.assert(
      fc.property(issueArbitrary, eventArbitrary, (state, event) => {
        const handSet = { ...state, priority: { level: 'low', setByHand: true } } as IssueState;
        const result = applyEvent(handSet, event, context);
        if (!isRefusal(result)) expect(result.state.priority).toEqual(handSet.priority);
      }),
    );
  });
});
