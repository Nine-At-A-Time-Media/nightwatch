import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  archive,
  beginDeletion,
  beginMerge,
  markReviewed,
  resolve,
  setPriority,
  unarchive,
  unresolve,
} from '../../../../src/domain/issue/commands.js';
import type { IssueState, IssueTransition, Status } from '../../../../src/domain/issue/state.js';
import { isRefusal, type Refusal } from '../../../../src/domain/refusal.js';
import { HOUR, T0, issueArbitrary, issueIn, member } from './fixtures.js';

const AT = T0 + HOUR;
const unresolvedAll: Status[] = (['new', 'ongoing', 'escalating', 'regressed'] as const).map((substatus) => ({ status: 'unresolved', substatus }));
const archivedAll: Status[] = [
  { status: 'archived', substatus: 'until_escalating' },
  {
    status: 'archived',
    substatus: 'until_condition',
    condition: { untilDate: T0, count: null, window: null, userCount: null, userWindow: null, baselineCount: 1, baselineUserCount: 1 },
  },
  { status: 'archived', substatus: 'forever', spam: false },
];
const resolved: Status = { status: 'resolved', resolution: { kind: 'plain' } };
const gone: Status[] = [{ status: 'deleting' }, { status: 'merging' }];

function done(result: IssueTransition | Refusal): IssueTransition {
  if (isRefusal(result)) throw new Error(result.refusal);
  return result;
}

function inReview(status: Status): IssueState {
  return issueIn(status, { forReviewSince: T0 });
}

describe('resolve', () => {
  it.each(unresolvedAll)('resolves an Unresolved/$substatus issue and takes it out of For Review', (status) => {
    const { state, changes } = done(resolve(inReview(status), { kind: 'in_release', release: '1.0.0' }, member, AT));
    expect(state).toMatchObject({ status: 'resolved', resolution: { kind: 'in_release', release: '1.0.0' }, substatusSince: AT, forReviewSince: null });
    expect(changes.map((c) => [c.kind, c.to])).toEqual([
      ['status', 'resolved'],
      ['resolution', 'in_release:1.0.0'],
      ['for_review', null],
    ]);
  });

  it('records a resolve that came from the tracker with the tracker as its origin', () => {
    const { changes } = done(resolve(issueIn(unresolvedAll[1]!), { kind: 'plain' }, 'tracker', AT));
    expect(changes[0]).toMatchObject({ actor: 'tracker', origin: 'tracker', from: 'unresolved/ongoing', to: 'resolved', at: AT });
  });

  it.each([resolved, ...archivedAll])('refuses to resolve an issue that is $status', (status) => {
    expect(resolve(issueIn(status), { kind: 'plain' }, member, AT)).toEqual({ refusal: 'transition_not_allowed' });
  });
});

describe('archive', () => {
  it('archives until escalating', () => {
    const { state, changes } = done(archive(inReview(unresolvedAll[0]!), { substatus: 'until_escalating' }, member, AT));
    expect(state).toMatchObject({ status: 'archived', substatus: 'until_escalating', forReviewSince: null });
    expect(changes[0]).toMatchObject({ kind: 'status', from: 'unresolved/new', to: 'archived/until_escalating', actor: member });
  });

  it('archives until a condition, taking the baseline counts at archiving', () => {
    const condition = { untilDate: null, count: 100, window: HOUR, userCount: 5, userWindow: null };
    const { state } = done(archive(issueIn(unresolvedAll[1]!, { count: 40, userCount: 7 }), { substatus: 'until_condition', condition }, member, AT));
    expect(state).toMatchObject({ status: 'archived', substatus: 'until_condition', condition: { ...condition, baselineCount: 40, baselineUserCount: 7 } });
  });

  it('refuses to archive until a condition that names no date, count or user count', () => {
    const condition = { untilDate: null, count: null, window: HOUR, userCount: null, userWindow: null };
    expect(archive(issueIn(unresolvedAll[1]!), { substatus: 'until_condition', condition }, member, AT)).toEqual({ refusal: 'condition_required' });
  });

  it('archives forever, as spam when the Report issue is judged spam', () => {
    expect(done(archive(issueIn(unresolvedAll[0]!), { substatus: 'forever', spam: true }, 'system', AT)).state).toMatchObject({
      status: 'archived',
      substatus: 'forever',
      spam: true,
    });
  });

  it.each([resolved, ...archivedAll])('refuses to archive an issue that is $status', (status) => {
    expect(archive(issueIn(status), { substatus: 'until_escalating' }, member, AT)).toEqual({ refusal: 'transition_not_allowed' });
  });
});

describe('unarchive and unresolve', () => {
  it.each(archivedAll)('unarchives an Archived/$substatus issue to Ongoing', (status) => {
    const { state, changes } = done(unarchive(issueIn(status), member, AT));
    expect(state).toMatchObject({ status: 'unresolved', substatus: 'ongoing', substatusSince: AT, forReviewSince: null });
    expect(changes[0]).toMatchObject({ kind: 'status', to: 'unresolved/ongoing' });
  });

  it('reopens a resolved issue to Ongoing, from a member or the tracker', () => {
    expect(done(unresolve(issueIn(resolved), member, AT)).state).toMatchObject({ status: 'unresolved', substatus: 'ongoing' });
    expect(done(unresolve(issueIn(resolved), 'tracker', AT)).changes[0]).toMatchObject({ origin: 'tracker' });
  });

  it('refuses to unarchive what is not archived, or reopen what is not resolved', () => {
    expect(unarchive(issueIn(resolved), member, AT)).toEqual({ refusal: 'transition_not_allowed' });
    expect(unarchive(issueIn(unresolvedAll[1]!), member, AT)).toEqual({ refusal: 'transition_not_allowed' });
    expect(unresolve(issueIn(archivedAll[0]!), member, AT)).toEqual({ refusal: 'transition_not_allowed' });
    expect(unresolve(issueIn(unresolvedAll[1]!), member, AT)).toEqual({ refusal: 'transition_not_allowed' });
  });
});

describe('setPriority and markReviewed', () => {
  it('a member sets Priority by hand, which marks it hand-set', () => {
    const { state, changes } = done(setPriority(inReview(resolved), 'low', member, AT));
    expect(state.priority).toEqual({ level: 'low', setByHand: true });
    expect(state.forReviewSince).toBeNull();
    expect(changes[0]).toMatchObject({ kind: 'priority', from: 'medium', to: 'low', actor: member });
  });

  it('marking an issue reviewed takes it out of For Review, and changes nothing when it was not in it', () => {
    const { state, changes } = done(markReviewed(inReview(unresolvedAll[0]!), member, AT));
    expect(state.forReviewSince).toBeNull();
    expect(changes).toEqual([expect.objectContaining({ kind: 'for_review', from: 'in', to: null })]);
    expect(done(markReviewed(issueIn(unresolvedAll[0]!), member, AT)).changes).toEqual([]);
  });
});

describe('deletion and merge', () => {
  it.each([...unresolvedAll, resolved, ...archivedAll])('moves an issue that is $status to Deleting or Merging', (status) => {
    expect(done(beginDeletion(issueIn(status), member, AT)).state.status).toBe('deleting');
    expect(done(beginMerge(issueIn(status), member, AT)).state.status).toBe('merging');
  });
});

describe('an issue being deleted or merged', () => {
  it.each(gone)('refuses every command when $status', (status) => {
    const state = issueIn(status);
    const refusals = [
      resolve(state, { kind: 'plain' }, member, AT),
      archive(state, { substatus: 'until_escalating' }, member, AT),
      unarchive(state, member, AT),
      unresolve(state, member, AT),
      setPriority(state, 'high', member, AT),
      markReviewed(state, member, AT),
      beginDeletion(state, member, AT),
      beginMerge(state, member, AT),
    ];
    expect(refusals).toEqual(Array(8).fill({ refusal: `issue_${status.status}` }));
  });
});

describe('every command', () => {
  it('records each change with the issue, actor, origin and time it was given, and never touches the counts', () => {
    fc.assert(
      fc.property(issueArbitrary, fc.constantFrom<'tracker' | typeof member>('tracker', member), (state, actor) => {
        const results = [
          resolve(state, { kind: 'plain' }, actor, AT),
          archive(state, { substatus: 'forever', spam: false }, actor, AT),
          unarchive(state, actor, AT),
          unresolve(state, actor, AT),
          setPriority(state, 'high', actor, AT),
          markReviewed(state, actor, AT),
        ];
        for (const result of results) {
          if (isRefusal(result)) continue;
          expect(result.state).toMatchObject({ count: state.count, userCount: state.userCount, firstSeen: state.firstSeen, lastSeen: state.lastSeen });
          for (const c of result.changes) {
            expect(c).toMatchObject({ issueId: state.issueId, actor, origin: actor === 'tracker' ? 'tracker' : 'nightwatch', at: AT });
          }
        }
      }),
    );
  });
});
