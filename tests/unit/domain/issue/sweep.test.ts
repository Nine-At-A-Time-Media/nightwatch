import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sweep } from '../../../../src/domain/issue/sweep.js';
import type { Status } from '../../../../src/domain/issue/state.js';
import { DAY, T0, issueArbitrary, issueIn, policies } from './fixtures.js';

const condition = {
  untilDate: T0 + DAY,
  count: null,
  window: null,
  userCount: null,
  userWindow: null,
  baselineCount: 1,
  baselineUserCount: 1,
};

describe('sweep', () => {
  it('New becomes ongoing: Given a New issue, When it is older than the New Issue Age, Then it becomes Ongoing', () => {
    const fresh = issueIn({ status: 'unresolved', substatus: 'new' });
    expect(sweep(fresh, T0 + 3 * DAY, policies)).toEqual({ state: fresh, changes: [] });
    const { state, changes } = sweep(fresh, T0 + 3 * DAY + 1, policies);
    expect(state).toMatchObject({ status: 'unresolved', substatus: 'ongoing', substatusSince: T0 + 3 * DAY + 1 });
    expect(changes).toEqual([
      {
        issueId: 'issue-1',
        kind: 'status',
        from: 'unresolved/new',
        to: 'unresolved/ongoing',
        actor: 'sweep',
        origin: 'nightwatch',
        at: T0 + 3 * DAY + 1,
      },
    ]);
  });

  it.each(['escalating', 'regressed'] as const)(
    'an Unresolved/%s issue settles to Ongoing after the Settle Age in that state',
    (substatus) => {
      const hot = issueIn({ status: 'unresolved', substatus }, { substatusSince: T0 + DAY });
      expect(sweep(hot, T0 + 8 * DAY, policies).state).toMatchObject({ substatus });
      expect(sweep(hot, T0 + 8 * DAY + 1, policies).state).toMatchObject({ substatus: 'ongoing' });
    },
  );

  it('an issue leaves For Review at the Inbox Expiry', () => {
    const waiting = issueIn({ status: 'unresolved', substatus: 'ongoing' }, { forReviewSince: T0 });
    expect(sweep(waiting, T0 + 7 * DAY, policies).state.forReviewSince).toBe(T0);
    const { state, changes } = sweep(waiting, T0 + 7 * DAY + 1, policies);
    expect(state.forReviewSince).toBeNull();
    expect(changes).toEqual([expect.objectContaining({ kind: 'for_review', from: 'in', to: null, actor: 'sweep' })]);
  });

  it('Archived until condition: Given an issue archived until a date, When the sweep finds the date passed, Then it becomes Ongoing and enters For Review', () => {
    const snoozed = issueIn({ status: 'archived', substatus: 'until_condition', condition });
    expect(sweep(snoozed, T0 + DAY - 1, policies).state.status).toBe('archived');
    const { state } = sweep(snoozed, T0 + DAY, policies);
    expect(state).toMatchObject({ status: 'unresolved', substatus: 'ongoing', forReviewSince: T0 + DAY });
  });

  it('Auto-resolve: Given a Project with an Auto-Resolve Age, When an issue is not seen for that age, Then it is resolved', () => {
    const autoResolving = { ...policies, autoResolveAge: 14 * DAY };
    const quiet = issueIn({ status: 'unresolved', substatus: 'ongoing' }, { forReviewSince: T0 + 10 * DAY });
    expect(sweep(quiet, T0 + 14 * DAY, autoResolving).state.status).toBe('unresolved');
    const { state, changes } = sweep(quiet, T0 + 14 * DAY + 1, autoResolving);
    expect(state).toMatchObject({ status: 'resolved', resolution: { kind: 'plain' }, forReviewSince: null });
    expect(changes[0]).toMatchObject({ kind: 'status', to: 'resolved', actor: 'sweep' });
  });

  it('never auto-resolves when the Project sets no Auto-Resolve Age, or an issue that is not unresolved', () => {
    const quiet = issueIn({ status: 'unresolved', substatus: 'ongoing' });
    expect(sweep(quiet, T0 + 1000 * DAY, policies).state.status).toBe('unresolved');
    const archived = issueIn({ status: 'archived', substatus: 'forever', spam: false });
    expect(sweep(archived, T0 + 1000 * DAY, { ...policies, autoResolveAge: DAY }).state.status).toBe('archived');
  });

  it.each<Status>([{ status: 'deleting' }, { status: 'merging' }])('leaves an issue that is $status alone', (status) => {
    const going = issueIn(status, { forReviewSince: T0 });
    expect(sweep(going, T0 + 1000 * DAY, { ...policies, autoResolveAge: DAY })).toEqual({ state: going, changes: [] });
  });

  it('is idempotent at a fixed time, and never touches the counts', () => {
    const autoResolveAge = fc.option(fc.integer({ min: 0, max: 40 * DAY }), { nil: null });
    fc.assert(
      fc.property(issueArbitrary, fc.integer({ min: T0, max: T0 + 60 * DAY }), autoResolveAge, (state, now, age) => {
        const tuned = { ...policies, autoResolveAge: age };
        const once = sweep(state, now, tuned);
        expect(sweep(once.state, now, tuned)).toEqual({ state: once.state, changes: [] });
        expect(once.state).toMatchObject({ count: state.count, userCount: state.userCount, lastSeen: state.lastSeen });
      }),
    );
  });
});
