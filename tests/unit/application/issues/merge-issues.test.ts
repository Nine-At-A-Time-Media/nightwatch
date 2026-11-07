import { describe, expect, it } from 'vitest';
import { assignEvent } from '../../../../src/application/issues/assign-event.js';
import { mergeIssues } from '../../../../src/application/issues/merge-issues.js';
import { HOUR, MINUTE, T0, issueIdOf, stateOf, summary, world } from './world.js';

const member = { member: 'member-1' };

function assignDeps(w: ReturnType<typeof world>) {
  return { issues: w.issues, clock: w.clock, ids: w.ids, policies: w.policies };
}

function mergeDeps(w: ReturnType<typeof world>) {
  return { issues: w.issues, blobs: w.blobs, effects: w.effects, clock: w.clock };
}

async function twoIssues(w: ReturnType<typeof world>) {
  const target = issueIdOf(await assignEvent(summary(T0, { userKey: 'u1' }), ['fp-a'], assignDeps(w)));
  await assignEvent(summary(T0 + MINUTE, { userKey: 'u2' }), ['fp-a'], assignDeps(w));
  const source = issueIdOf(await assignEvent(summary(T0 - HOUR, { userKey: 'u1' }), ['fp-b'], assignDeps(w)));
  return { target, source };
}

describe('mergeIssues', () => {
  it('Merge: Given two issues, When a member merges them, Then one issue holds all Fingerprints, events, counts, comments and Reports', async () => {
    const w = world();
    const { target, source } = await twoIssues(w);
    w.clock.set(T0 + HOUR);
    const changes = await mergeIssues(target, [source], member, mergeDeps(w));
    expect(await w.issues.getIssue(source)).toBeNull();
    expect([...(await w.issues.fingerprintsOf(target))].sort()).toEqual(['fp-a', 'fp-b']);
    expect(await w.issues.eventsOf(target)).toHaveLength(3);
    expect(await stateOf(w.issues, target)).toMatchObject({ count: 3, userCount: 2, firstSeen: T0 - HOUR, lastSeen: T0 + MINUTE });
    expect(changes).toEqual([
      { issueId: source, kind: 'status', from: 'unresolved/new', to: 'merging', actor: member, origin: 'nightwatch', at: T0 + HOUR },
      { issueId: target, kind: 'merge', from: source, to: target, actor: member, origin: 'nightwatch', at: T0 + HOUR },
    ]);
    expect(w.effects.enqueued).toEqual(changes);
    expect(w.issues.history).toEqual(expect.arrayContaining(w.effects.enqueued));
    const later = await assignEvent(summary(T0 + 2 * HOUR), ['fp-b'], assignDeps(w));
    expect(issueIdOf(later)).toBe(target);
  });

  it('refuses a missing target or source, or a target among the sources, and changes nothing', async () => {
    const w = world();
    const { target, source } = await twoIssues(w);
    expect(await mergeIssues('issue-404', [source], member, mergeDeps(w))).toEqual({ refusal: 'issue_not_found' });
    expect(await mergeIssues(target, [source, 'issue-404'], member, mergeDeps(w))).toEqual({ refusal: 'issue_not_found' });
    expect(await mergeIssues(target, [target], member, mergeDeps(w))).toEqual({ refusal: 'merge_into_itself' });
    expect(await stateOf(w.issues, source)).toMatchObject({ status: 'unresolved', count: 1 });
    expect(await stateOf(w.issues, target)).toMatchObject({ count: 2 });
    expect(w.effects.enqueued).toEqual([]);
  });
});
