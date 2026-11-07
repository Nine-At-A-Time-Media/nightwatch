import { describe, expect, it } from 'vitest';
import { assignEvent } from '../../../../src/application/issues/assign-event.js';
import { discardIssue } from '../../../../src/application/issues/discard-issue.js';
import { eventBlobKey } from '../../../../src/domain/event/event-summary.js';
import { HOUR, T0, issueIdOf, summary, world } from './world.js';

const member = { member: 'member-1' };

function assignDeps(w: ReturnType<typeof world>) {
  return { issues: w.issues, clock: w.clock, ids: w.ids, policies: w.policies };
}

function discardDeps(w: ReturnType<typeof world>) {
  return { issues: w.issues, blobs: w.blobs, clock: w.clock };
}

describe('discardIssue', () => {
  it('Discard: Given an issue, When a member discards it, Then the issue is gone and future events with its Fingerprints are dropped', async () => {
    const w = world();
    const first = summary(T0);
    const second = summary(T0 + 1);
    const id = issueIdOf(await assignEvent(first, ['fp-a', 'fp-b'], assignDeps(w)));
    await assignEvent(second, ['fp-a'], assignDeps(w));
    const other = issueIdOf(await assignEvent(summary(T0), ['fp-c'], assignDeps(w)));
    await w.blobs.put(eventBlobKey(first.eventId), new TextEncoder().encode('{}'));
    await w.blobs.put(eventBlobKey(second.eventId), new TextEncoder().encode('{}'));
    await w.blobs.put('events/unrelated', new TextEncoder().encode('{}'));
    w.clock.set(T0 + HOUR);
    const changes = await discardIssue(id, member, discardDeps(w));
    expect(changes).toEqual([
      { issueId: id, kind: 'status', from: 'unresolved/new', to: 'deleting', actor: member, origin: 'nightwatch', at: T0 + HOUR },
    ]);
    expect(await w.issues.getIssue(id)).toBeNull();
    expect(await w.issues.eventsOf(id)).toEqual([]);
    expect([...w.blobs.blobs.keys()]).toEqual(['events/unrelated']);
    expect(w.issues.history.at(-1)).toEqual({
      issueId: id,
      kind: 'status',
      from: 'unresolved/new',
      to: 'deleting',
      actor: member,
      origin: 'nightwatch',
      at: T0 + HOUR,
    });
    expect(await assignEvent(summary(T0 + 2 * HOUR), ['fp-b'], assignDeps(w))).toEqual({ tombstone: id, changes: [], duplicate: false });
    expect(issueIdOf(await assignEvent(summary(T0 + 2 * HOUR), ['fp-c'], assignDeps(w)))).toBe(other);
  });

  it('refuses a missing issue', async () => {
    const w = world();
    expect(await discardIssue('issue-404', member, discardDeps(w))).toEqual({ refusal: 'issue_not_found' });
  });
});
