import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { EventSummary } from '../../../../src/domain/event/event-summary.js';
import { eventBlobKey } from '../../../../src/domain/event/event-summary.js';
import { duplicateOf, dropped, joined, targetOf } from '../../../../src/domain/issue/assignment.js';
import { absorbMerge, beginMerges, mergeRefusal, recount, splitOff, splitRefusal } from '../../../../src/domain/issue/regroup.js';
import { conditionWindows, hourStart, isHeldBy } from '../../../../src/domain/issue/tally.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { HOUR, T0, issueArbitrary, issueIn, member } from './fixtures.js';

function summary(eventId: string, at: number, userKey: string | null = null): EventSummary {
  return { eventId, at, release: null, environment: null, level: 'error', userKey, title: 'E', culprit: null };
}

const ongoing = { status: 'unresolved', substatus: 'ongoing' } as const;

describe('recount', () => {
  it('counts events, distinct users, and the first and last time seen', () => {
    const events = [summary('a', T0 + 5, 'u1'), summary('b', T0 + 1, 'u2'), summary('c', T0 + 9, 'u1'), summary('d', T0 + 3)];
    expect(recount(issueIn(ongoing), events)).toMatchObject({ count: 4, userCount: 2, firstSeen: T0 + 1, lastSeen: T0 + 9 });
  });

  it('keeps first and last seen when no event remains', () => {
    const state = issueIn(ongoing, { firstSeen: T0, lastSeen: T0 + HOUR });
    expect(recount(state, [])).toMatchObject({ count: 0, userCount: 0, firstSeen: T0, lastSeen: T0 + HOUR });
  });

  it('property: the count is the number of events and the user count never exceeds it', () => {
    const arb = fc.array(
      fc.record({ at: fc.integer({ min: T0, max: T0 + 100 * HOUR }), user: fc.option(fc.constantFrom('u1', 'u2', 'u3'), { nil: null }) }),
    );
    fc.assert(
      fc.property(issueArbitrary, arb, (state, raw) => {
        const counted = recount(
          state,
          raw.map((e, i) => summary(`e${i}`, e.at, e.user)),
        );
        expect(counted.count).toBe(raw.length);
        expect(counted.userCount).toBeLessThanOrEqual(Math.min(raw.length, 3));
        if (raw.length > 0) expect(counted.firstSeen).toBeLessThanOrEqual(counted.lastSeen);
      }),
    );
  });
});

describe('merge', () => {
  it('refuses a merge with no sources, with the target among them, or with a source named twice', () => {
    expect(mergeRefusal({ target: 't', sources: [] })).toEqual({ refusal: 'merge_needs_sources' });
    expect(mergeRefusal({ target: 't', sources: ['s', 't'] })).toEqual({ refusal: 'merge_into_itself' });
    expect(mergeRefusal({ target: 't', sources: ['s', 's'] })).toEqual({ refusal: 'merge_source_repeated' });
    expect(mergeRefusal({ target: 't', sources: ['s', 'r'] })).toBeNull();
  });

  it('moves each source to Merging, refusing when one is already going away', () => {
    const sources = [
      issueIn(ongoing, { issueId: 's1' }),
      issueIn({ status: 'resolved', resolution: { kind: 'plain' } }, { issueId: 's2' }),
    ];
    const begun = beginMerges(sources, member, T0);
    if (isRefusal(begun)) throw new Error(begun.refusal);
    expect(begun.map((t) => t.state.status)).toEqual(['merging', 'merging']);
    expect(beginMerges([issueIn({ status: 'deleting' })], member, T0)).toEqual({ refusal: 'issue_deleting' });
  });

  it('the target absorbs the counts of all its events and records one merge change per source', () => {
    const target = issueIn(ongoing, { issueId: 't', count: 1, userCount: 1 });
    const events = [summary('a', T0, 'u1'), summary('b', T0 + 2, 'u2'), summary('c', T0 - 7, 'u1')];
    const absorbed = absorbMerge({ target, sources: ['s1', 's2'], events, actor: member, at: T0 + 10 });
    if (isRefusal(absorbed)) throw new Error(absorbed.refusal);
    expect(absorbed.state).toMatchObject({ issueId: 't', count: 3, userCount: 2, firstSeen: T0 - 7, lastSeen: T0 + 2 });
    expect(absorbed.changes).toEqual([
      { issueId: 't', kind: 'merge', from: 's1', to: 't', actor: member, origin: 'nightwatch', at: T0 + 10 },
      { issueId: 't', kind: 'merge', from: 's2', to: 't', actor: member, origin: 'nightwatch', at: T0 + 10 },
    ]);
  });

  it('refuses to merge into an issue that is going away', () => {
    expect(absorbMerge({ target: issueIn({ status: 'merging' }), sources: ['s'], events: [], actor: member, at: T0 })).toEqual({
      refusal: 'issue_merging',
    });
  });
});

describe('split', () => {
  it('refuses to split nothing, a Fingerprint the issue does not hold, or every Fingerprint it holds', () => {
    expect(splitRefusal({ held: ['a', 'b'], chosen: [] })).toEqual({ refusal: 'split_needs_fingerprints' });
    expect(splitRefusal({ held: ['a', 'b'], chosen: ['c'] })).toEqual({ refusal: 'fingerprint_not_held' });
    expect(splitRefusal({ held: ['a', 'b'], chosen: ['a', 'b'] })).toEqual({ refusal: 'split_leaves_nothing' });
    expect(splitRefusal({ held: ['a', 'b'], chosen: ['b'] })).toBeNull();
  });

  it('opens a New issue in For Review holding the moved events and recounts the issue split from', () => {
    const from = issueIn(ongoing, { issueId: 'old', count: 3, priority: { level: 'high', setByHand: true } });
    const result = splitOff({
      from,
      issueId: 'new',
      remaining: [summary('a', T0)],
      moved: [summary('b', T0 + 1, 'u1'), summary('c', T0 + 2, 'u1')],
      actor: member,
      at: T0 + 5,
    });
    if (isRefusal(result)) throw new Error(result.refusal);
    expect(result.from.state).toMatchObject({ issueId: 'old', count: 1, status: 'unresolved', substatus: 'ongoing' });
    expect(result.split.state).toMatchObject({
      issueId: 'new',
      status: 'unresolved',
      substatus: 'new',
      count: 2,
      userCount: 1,
      firstSeen: T0 + 1,
      lastSeen: T0 + 2,
      forReviewSince: T0 + 5,
      priority: { level: 'high', setByHand: true },
    });
    expect(result.from.changes).toEqual([
      { issueId: 'old', kind: 'split', from: 'old', to: 'new', actor: member, origin: 'nightwatch', at: T0 + 5 },
    ]);
    expect(result.split.changes.map((c) => [c.kind, c.from, c.to])).toEqual([
      ['status', null, 'unresolved/new'],
      ['split', 'old', 'new'],
      ['for_review', null, 'in'],
    ]);
  });

  it('a split issue with no events yet is first seen when it is split', () => {
    const result = splitOff({ from: issueIn(ongoing), issueId: 'new', remaining: [], moved: [], actor: member, at: T0 + 9 });
    if (isRefusal(result)) throw new Error(result.refusal);
    expect(result.split.state).toMatchObject({ count: 0, firstSeen: T0 + 9, lastSeen: T0 + 9 });
  });

  it('refuses to split an issue that is going away', () => {
    const result = splitOff({ from: issueIn({ status: 'deleting' }), issueId: 'n', remaining: [], moved: [], actor: member, at: T0 });
    expect(result).toEqual({ refusal: 'issue_deleting' });
  });
});

describe('tally helpers', () => {
  it('hourStart is the start of the clock hour', () => {
    expect(hourStart(T0 + HOUR + 59 * 60_000)).toBe(T0 + HOUR);
    fc.assert(fc.property(fc.integer({ min: 0, max: 2 ** 45 }), (at) => hourStart(at) <= at && at - hourStart(at) < HOUR));
  });

  it('an event is held by Fingerprints when it shares any of them', () => {
    expect(isHeldBy({ summary: summary('a', T0), fingerprints: ['x', 'y'] }, ['y'])).toBe(true);
    expect(isHeldBy({ summary: summary('a', T0), fingerprints: ['x'] }, ['y'])).toBe(false);
  });

  it('names the windows an archived-until-condition issue counts over, and none otherwise', () => {
    const condition = { untilDate: null, count: 5, window: HOUR, userCount: 2, userWindow: null, baselineCount: 0, baselineUserCount: 0 };
    expect(conditionWindows(issueIn({ status: 'archived', substatus: 'until_condition', condition }))).toEqual({
      window: HOUR,
      userWindow: null,
    });
    expect(conditionWindows(issueIn(ongoing))).toEqual({ window: null, userWindow: null });
  });
});

describe('assignment', () => {
  it('a joined, dropped or duplicate Assignment names its issue or Tombstone', () => {
    const joinedAssignment = joined('i', []);
    expect(joinedAssignment).toEqual({ issueId: 'i', changes: [], duplicate: false });
    const droppedAssignment = dropped({ issueId: 'gone', fingerprints: ['f'], at: T0, actor: member });
    expect(droppedAssignment).toEqual({ tombstone: 'gone', changes: [], duplicate: false });
    expect(targetOf(joinedAssignment)).toEqual({ issueId: 'i' });
    expect(targetOf(droppedAssignment)).toEqual({ tombstone: 'gone' });
    expect(duplicateOf({ issueId: 'i' })).toEqual({ issueId: 'i', changes: [], duplicate: true });
  });

  it('a stored Event is keyed by its id under events/', () => {
    expect(eventBlobKey('abc')).toBe('events/abc');
  });
});
