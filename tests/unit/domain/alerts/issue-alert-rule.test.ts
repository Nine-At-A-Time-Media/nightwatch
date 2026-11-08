import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  evaluateRule,
  type AlertContext,
  type AlertEvent,
  type Filter,
  type IssueAlertRule,
  type Trigger,
} from '../../../../src/domain/alerts/issue-alert-rule.js';
import type { IssueChange } from '../../../../src/domain/issue/state.js';
import { DAY, HOUR, MINUTE, T0, issueIn } from '../issue/fixtures.js';

const NOW = T0 + 2 * DAY;

function ruleOf(overrides: Partial<IssueAlertRule> = {}): IssueAlertRule {
  return {
    ruleId: 'rule-1',
    triggers: [{ kind: 'first_seen' }],
    actionMatch: 'any',
    filters: [],
    filterMatch: 'all',
    actions: [{ kind: 'email', to: { kind: 'owners' } }],
    quietPeriodMs: 30 * MINUTE,
    ...overrides,
  };
}

function statusChange(from: string | null, to: string): IssueChange {
  return { issueId: 'issue-1', kind: 'status', from, to, actor: 'system', origin: 'nightwatch', at: NOW };
}

function eventOf(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    eventId: 'event-1',
    at: NOW,
    release: '1.2.0',
    environment: 'production',
    level: 'error',
    userKey: 'user-1',
    title: 'TypeError: x is undefined',
    culprit: 'app/cart.ts',
    tags: { browser: 'Firefox 140', 'os.name': 'Linux' },
    attributes: { 'exception.type': 'TypeError', 'request.url': 'https://shop.example.com/cart' },
    ...overrides,
  };
}

function contextOf(overrides: Partial<AlertContext> = {}): AlertContext {
  return {
    change: statusChange(null, 'unresolved/new'),
    issue: issueIn({ status: 'unresolved', substatus: 'new' }),
    issueKind: 'crash',
    assignee: null,
    event: eventOf(),
    counts: { eventsInWindow: 1, usersInWindow: 1 },
    lastFiredAt: null,
    now: NOW,
    latestRelease: '1.2.0',
    ...overrides,
  };
}

function firesWith(filter: Filter, overrides: Partial<AlertContext> = {}): boolean {
  return evaluateRule(ruleOf({ filters: [filter] }), contextOf(overrides)).fire;
}

describe('Issue Alert Rule triggers', () => {
  it('New issue alert: Given a rule triggering on first seen, When a new issue is created, Then its actions run once', () => {
    expect(evaluateRule(ruleOf(), contextOf())).toEqual({ fire: true, reason: 'fired' });
    expect(evaluateRule(ruleOf(), contextOf({ change: statusChange('unresolved/new', 'unresolved/ongoing') }))).toEqual({
      fire: false,
      reason: 'no_trigger',
    });
  });

  it('fires on regression, unarchiving and escalation changes', () => {
    const cases: readonly (readonly [Trigger, IssueChange])[] = [
      [{ kind: 'regression' }, statusChange('resolved', 'unresolved/regressed')],
      [{ kind: 'unarchived' }, statusChange('archived/until_condition', 'unresolved/ongoing')],
      [{ kind: 'escalating' }, statusChange('archived/until_escalating', 'unresolved/escalating')],
      [{ kind: 'escalating' }, statusChange('unresolved/new', 'unresolved/escalating')],
    ];
    for (const [trigger, change] of cases) {
      expect(evaluateRule(ruleOf({ triggers: [trigger] }), contextOf({ change })).fire).toBe(true);
      expect(evaluateRule(ruleOf({ triggers: [trigger] }), contextOf({ change: statusChange(null, 'unresolved/new') })).fire).toBe(false);
    }
  });

  it('does not count a reopen from resolved as unarchived', () => {
    expect(
      evaluateRule(ruleOf({ triggers: [{ kind: 'unarchived' }] }), contextOf({ change: statusChange('resolved', 'unresolved/ongoing') }))
        .fire,
    ).toBe(false);
  });

  it('every event fires whenever an event arrived, and never without one', () => {
    const rule = ruleOf({ triggers: [{ kind: 'every_event' }] });
    expect(evaluateRule(rule, contextOf({ change: null })).fire).toBe(true);
    expect(evaluateRule(rule, contextOf({ event: null })).fire).toBe(false);
  });

  it('Frequency alert: Given a rule triggering on more than N events in a window, When the Nth plus one event arrives, Then the actions run', () => {
    const rule = ruleOf({ triggers: [{ kind: 'event_frequency', count: 10, windowMs: HOUR }] });
    expect(evaluateRule(rule, contextOf({ change: null, counts: { eventsInWindow: 10, usersInWindow: 1 } })).fire).toBe(false);
    expect(evaluateRule(rule, contextOf({ change: null, counts: { eventsInWindow: 11, usersInWindow: 1 } })).fire).toBe(true);
  });

  it('a user frequency trigger counts users, not events', () => {
    const rule = ruleOf({ triggers: [{ kind: 'user_frequency', count: 3, windowMs: HOUR }] });
    expect(evaluateRule(rule, contextOf({ counts: { eventsInWindow: 100, usersInWindow: 3 } })).fire).toBe(false);
    expect(evaluateRule(rule, contextOf({ counts: { eventsInWindow: 4, usersInWindow: 4 } })).fire).toBe(true);
  });

  it('action match all needs every trigger, any needs one, and a rule with no trigger never fires', () => {
    const triggers: readonly Trigger[] = [{ kind: 'first_seen' }, { kind: 'event_frequency', count: 5, windowMs: HOUR }];
    expect(evaluateRule(ruleOf({ triggers, actionMatch: 'all' }), contextOf()).fire).toBe(false);
    expect(evaluateRule(ruleOf({ triggers, actionMatch: 'any' }), contextOf()).fire).toBe(true);
    expect(
      evaluateRule(ruleOf({ triggers, actionMatch: 'all' }), contextOf({ counts: { eventsInWindow: 6, usersInWindow: 1 } })).fire,
    ).toBe(true);
    expect(evaluateRule(ruleOf({ triggers: [], actionMatch: 'all' }), contextOf()).fire).toBe(false);
  });
});

describe('Issue Alert Rule quiet period', () => {
  it('Quiet period: Given a rule fired for an issue, When the trigger is met again inside the Alert Quiet Period, Then the actions do not run', () => {
    const rule = ruleOf();
    expect(evaluateRule(rule, contextOf({ lastFiredAt: NOW - 29 * MINUTE }))).toEqual({ fire: false, reason: 'quiet_period' });
    expect(evaluateRule(rule, contextOf({ lastFiredAt: NOW - 30 * MINUTE })).fire).toBe(true);
  });

  it('never fires twice for one issue inside the Alert Quiet Period, whatever the sequence of evaluations', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 * HOUR }),
        fc.array(fc.integer({ min: 0, max: HOUR }), { minLength: 1, maxLength: 40 }),
        (quietPeriodMs, gaps) => {
          const rule = ruleOf({ triggers: [{ kind: 'every_event' }], quietPeriodMs });
          const firings = gaps.reduce<{ now: number; fired: readonly number[] }>(
            (acc, gap) => {
              const now = acc.now + gap;
              const lastFiredAt = acc.fired.at(-1) ?? null;
              const { fire } = evaluateRule(rule, contextOf({ change: null, now, lastFiredAt }));
              return { now, fired: fire ? [...acc.fired, now] : acc.fired };
            },
            { now: NOW, fired: [] },
          ).fired;
          firings.slice(1).forEach((at, i) => expect(at - (firings[i] ?? 0)).toBeGreaterThanOrEqual(quietPeriodMs));
        },
      ),
    );
  });
});

describe('Issue Alert Rule filters', () => {
  it('Filter blocks: Given a rule filtered to environment production, When a staging event meets the trigger, Then the actions do not run', () => {
    const rule = ruleOf({ filters: [{ kind: 'environment', environment: 'production' }] });
    expect(evaluateRule(rule, contextOf({ event: eventOf({ environment: 'staging' }) }))).toEqual({ fire: false, reason: 'filtered' });
    expect(evaluateRule(rule, contextOf()).fire).toBe(true);
  });

  it('a level filter passes events at or above its level', () => {
    const filter: Filter = { kind: 'level', atLeast: 'error' };
    expect(firesWith(filter, { event: eventOf({ level: 'fatal' }) })).toBe(true);
    expect(firesWith(filter, { event: eventOf({ level: 'error' }) })).toBe(true);
    expect(firesWith(filter, { event: eventOf({ level: 'warning' }) })).toBe(false);
  });

  it('tag and attribute filters match their value as a glob', () => {
    expect(firesWith({ kind: 'tag', key: 'browser', value: 'Firefox*' })).toBe(true);
    expect(firesWith({ kind: 'tag', key: 'browser', value: 'Chrome*' })).toBe(false);
    expect(firesWith({ kind: 'tag', key: 'device', value: '*' })).toBe(false);
    expect(firesWith({ kind: 'attribute', path: 'request.url', value: '*/cart' })).toBe(true);
    expect(firesWith({ kind: 'attribute', path: 'exception.type', value: 'RangeError' })).toBe(false);
  });

  it('an issue age filter compares the time since the issue was first seen', () => {
    expect(firesWith({ kind: 'issue_age', comparison: 'older', ageMs: DAY })).toBe(true);
    expect(firesWith({ kind: 'issue_age', comparison: 'newer', ageMs: DAY })).toBe(false);
    expect(firesWith({ kind: 'issue_age', comparison: 'newer', ageMs: 3 * DAY })).toBe(true);
  });

  it('an assignee filter matches the member, the team, or no assignee', () => {
    expect(firesWith({ kind: 'assignee', assignee: 'unassigned' })).toBe(true);
    expect(firesWith({ kind: 'assignee', assignee: { member: 'm1' } }, { assignee: { member: 'm1' } })).toBe(true);
    expect(firesWith({ kind: 'assignee', assignee: { member: 'm1' } }, { assignee: { member: 'm2' } })).toBe(false);
    expect(firesWith({ kind: 'assignee', assignee: { team: 't1' } }, { assignee: { team: 't1' } })).toBe(true);
    expect(firesWith({ kind: 'assignee', assignee: 'unassigned' }, { assignee: { team: 't1' } })).toBe(false);
  });

  it('a release filter passes only events from the latest release', () => {
    expect(firesWith({ kind: 'release', release: 'latest' })).toBe(true);
    expect(firesWith({ kind: 'release', release: 'latest' }, { event: eventOf({ release: '1.1.0' }) })).toBe(false);
    expect(firesWith({ kind: 'release', release: 'latest' }, { latestRelease: null })).toBe(false);
  });

  it('an issue kind filter tells crash issues from Report issues', () => {
    expect(firesWith({ kind: 'issue_kind', issueKind: 'crash' })).toBe(true);
    expect(firesWith({ kind: 'issue_kind', issueKind: 'report' })).toBe(false);
  });

  it('an event filter does not pass when no event arrived', () => {
    expect(firesWith({ kind: 'environment', environment: 'production' }, { event: null })).toBe(false);
  });

  it('filter match all, any and none combine the filters', () => {
    const filters: readonly Filter[] = [
      { kind: 'environment', environment: 'production' },
      { kind: 'level', atLeast: 'fatal' },
    ];
    expect(evaluateRule(ruleOf({ filters, filterMatch: 'all' }), contextOf()).fire).toBe(false);
    expect(evaluateRule(ruleOf({ filters, filterMatch: 'any' }), contextOf()).fire).toBe(true);
    expect(evaluateRule(ruleOf({ filters, filterMatch: 'none' }), contextOf()).fire).toBe(false);
    expect(evaluateRule(ruleOf({ filters, filterMatch: 'none' }), contextOf({ event: eventOf({ environment: 'staging' }) })).fire).toBe(
      true,
    );
    expect(evaluateRule(ruleOf({ filters: [], filterMatch: 'any' }), contextOf()).fire).toBe(true);
  });
});
