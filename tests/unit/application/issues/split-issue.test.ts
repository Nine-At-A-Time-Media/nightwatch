import { describe, expect, it } from 'vitest';
import { assignEvent } from '../../../../src/application/issues/assign-event.js';
import { splitIssue } from '../../../../src/application/issues/split-issue.js';
import { HOUR, MINUTE, T0, issueIdOf, stateOf, summary, world } from './world.js';

const member = { member: 'member-1' };

function assignDeps(w: ReturnType<typeof world>) {
  return { issues: w.issues, clock: w.clock, ids: w.ids, policies: w.policies };
}

function splitDeps(w: ReturnType<typeof world>) {
  return { issues: w.issues, ids: w.ids, clock: w.clock };
}

async function issueWithTwoFingerprints(w: ReturnType<typeof world>): Promise<string> {
  const id = issueIdOf(await assignEvent(summary(T0), ['fp-a', 'fp-b'], assignDeps(w)));
  await assignEvent(summary(T0 + MINUTE), ['fp-a'], assignDeps(w));
  await assignEvent(summary(T0 + 2 * MINUTE, { userKey: 'u1' }), ['fp-b'], assignDeps(w));
  return id;
}

function newIssueOf(changes: readonly { kind: string; to: string | null }[]): string {
  const split = changes.find((c) => c.kind === 'split');
  if (!split?.to) throw new Error('no split change');
  return split.to;
}

describe('splitIssue', () => {
  it("Split: Given an issue with two Fingerprints, When a member splits one off, Then a new issue holds that Fingerprint's events, including events that arrived during the split", async () => {
    const w = world();
    const id = await issueWithTwoFingerprints(w);
    w.clock.set(T0 + HOUR);
    const arriving = summary(T0 + HOUR);
    const [changes, during] = await Promise.all([
      splitIssue(id, ['fp-b'], member, splitDeps(w)),
      assignEvent(arriving, ['fp-b'], assignDeps(w)),
    ]);
    if (!Array.isArray(changes)) throw new Error('split refused');
    const created = newIssueOf(changes);
    expect(issueIdOf(during)).toBe(created);
    expect((await w.issues.eventsOf(created)).map((e) => e.summary.eventId)).toContain(arriving.eventId);
    expect(await w.issues.fingerprintsOf(created)).toEqual(['fp-b']);
    expect(await w.issues.fingerprintsOf(id)).toEqual(['fp-a']);
    expect(await stateOf(w.issues, created)).toMatchObject({ status: 'unresolved', substatus: 'new', count: 3, userCount: 1 });
    expect(await stateOf(w.issues, id)).toMatchObject({ count: 1 });
    expect(await w.issues.shortIdOf(created)).toBe(2);
    expect(w.issues.history).toEqual(expect.arrayContaining(changes));
    const after = await assignEvent(summary(T0 + 2 * HOUR), ['fp-b'], assignDeps(w));
    expect(issueIdOf(after)).toBe(created);
  });

  it('refuses a missing issue, a Fingerprint the issue does not hold, or every Fingerprint it holds', async () => {
    const w = world();
    const id = await issueWithTwoFingerprints(w);
    expect(await splitIssue('issue-404', ['fp-a'], member, splitDeps(w))).toEqual({ refusal: 'issue_not_found' });
    expect(await splitIssue(id, ['fp-z'], member, splitDeps(w))).toEqual({ refusal: 'fingerprint_not_held' });
    expect(await splitIssue(id, ['fp-a', 'fp-b'], member, splitDeps(w))).toEqual({ refusal: 'split_leaves_nothing' });
    expect(await w.issues.listIssues()).toHaveLength(1);
    expect(await stateOf(w.issues, id)).toMatchObject({ count: 3 });
  });
});
