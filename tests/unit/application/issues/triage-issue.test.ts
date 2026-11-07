// triageIssue: a Member's triage action on one Issue. The state and its
// History are written in one transaction and the Issue Changes enqueued;
// a refused action writes and enqueues nothing.
import { describe, expect, it } from 'vitest';
import { assignEvent } from '../../../../src/application/issues/assign-event.js';
import { recordReleaseSeen } from '../../../../src/application/issues/record-release-seen.js';
import { triageIssue } from '../../../../src/application/issues/triage-issue.js';
import { HOUR, MINUTE, T0, issueIdOf, stateOf, summary, world } from './world.js';

const member = { member: 'member-1' };
const CRASH = ['fp-a'];

type World = ReturnType<typeof world>;

function assignDeps(w: World) {
  return { issues: w.issues, clock: w.clock, ids: w.ids, policies: w.policies };
}

function deps(w: World) {
  return { issues: w.issues, effects: w.effects, clock: w.clock };
}

/** A New Issue in For Review, with nothing enqueued yet, the clock an hour on. */
async function newIssue(w: World, release: string | null = null): Promise<string> {
  const id = issueIdOf(await assignEvent(summary(T0, { release }), CRASH, assignDeps(w)));
  w.effects.enqueued.length = 0;
  w.clock.set(T0 + HOUR);
  return id;
}

describe('triageIssue', () => {
  it('resolve plainly: the Issue is Resolved, out of For Review, with History written and the changes enqueued', async () => {
    const w = world();
    const id = await newIssue(w);
    const historyBefore = w.issues.history.length;

    const changes = await triageIssue(id, { kind: 'resolve', resolution: { kind: 'plain' } }, member, deps(w));

    expect(Array.isArray(changes) && changes.map((change) => [change.kind, change.to, change.at])).toEqual([
      ['status', 'resolved', T0 + HOUR],
      ['resolution', 'plain', T0 + HOUR],
      ['for_review', null, T0 + HOUR],
    ]);
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'resolved', resolution: { kind: 'plain' }, forReviewSince: null });
    expect(w.issues.history.slice(historyBefore)).toEqual(changes);
    expect(w.effects.enqueued).toEqual(changes);
  });

  it('resolve in a release names it in the Resolution', async () => {
    const w = world();
    const id = await newIssue(w, '1.2.0');
    await triageIssue(id, { kind: 'resolve', resolution: { kind: 'in_release', release: '1.2.0' } }, member, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ resolution: { kind: 'in_release', release: '1.2.0' } });
  });

  it('Resolve in next release: Given an issue resolved in next release, When the next release is first seen, Then the Resolution names that release', async () => {
    const w = world();
    const id = await newIssue(w, '1.0.0');
    await recordReleaseSeen('1.0.0', { issues: w.issues, effects: w.effects, clock: w.clock });

    await triageIssue(id, { kind: 'resolve', resolution: { kind: 'in_next_release' } }, member, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ resolution: { kind: 'in_next_release', release: null } });

    await recordReleaseSeen('1.1.0', { issues: w.issues, effects: w.effects, clock: w.clock });
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'resolved', resolution: { kind: 'in_next_release', release: '1.1.0' } });
  });

  it('Archived until escalating: archiving until escalating holds the Issue in Archived/Until escalating', async () => {
    const w = world();
    const id = await newIssue(w);
    await triageIssue(id, { kind: 'archive', archive: { substatus: 'until_escalating' } }, member, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'archived', substatus: 'until_escalating' });
  });

  it('Archived until condition: Given an issue archived until a count, When the condition is met, Then it becomes Ongoing', async () => {
    const w = world();
    const id = await newIssue(w);
    const condition = { untilDate: null, count: 2, window: null, userCount: null, userWindow: null };
    await triageIssue(id, { kind: 'archive', archive: { substatus: 'until_condition', condition } }, member, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'archived', substatus: 'until_condition' });

    for (let i = 1; i <= 2; i++) await assignEvent(summary(T0 + HOUR + i * MINUTE), CRASH, assignDeps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'unresolved', substatus: 'ongoing' });
  });

  it('Archived forever stays: Given an issue archived forever, When events arrive, Then it stays archived and counts rise', async () => {
    const w = world();
    const id = await newIssue(w);
    await triageIssue(id, { kind: 'archive', archive: { substatus: 'forever' } }, member, deps(w));
    for (let i = 1; i <= 3; i++) await assignEvent(summary(T0 + HOUR + i * MINUTE), CRASH, assignDeps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'archived', substatus: 'forever', spam: false, count: 4 });
  });

  it('unarchive and unresolve bring the Issue back to Ongoing', async () => {
    const w = world();
    const id = await newIssue(w);
    await triageIssue(id, { kind: 'archive', archive: { substatus: 'forever' } }, member, deps(w));
    await triageIssue(id, { kind: 'unarchive' }, member, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'unresolved', substatus: 'ongoing' });

    await triageIssue(id, { kind: 'resolve', resolution: { kind: 'plain' } }, member, deps(w));
    await triageIssue(id, { kind: 'unresolve' }, member, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'unresolved', substatus: 'ongoing' });
  });

  it("Hand-set priority sticks: Given a member set an issue's Priority, When the issue escalates, Then its Priority does not change", async () => {
    const w = world({ policies: { earlyEscalation: { youngAge: 24 * HOUR, minimumCount: 3, rateMultiple: 2 } }, projectNormalRate: 1 });
    const id = await newIssue(w);
    await triageIssue(id, { kind: 'set_priority', level: 'low' }, member, deps(w));
    await assignEvent(summary(T0 + HOUR + MINUTE), CRASH, assignDeps(w));
    await assignEvent(summary(T0 + HOUR + 2 * MINUTE), CRASH, assignDeps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ substatus: 'escalating', priority: { level: 'low', setByHand: true } });
  });

  it('mark reviewed takes the Issue out of For Review and changes nothing else', async () => {
    const w = world();
    const id = await newIssue(w);
    const changes = await triageIssue(id, { kind: 'mark_reviewed' }, member, deps(w));
    expect(Array.isArray(changes) && changes.map((change) => change.kind)).toEqual(['for_review']);
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'unresolved', substatus: 'new', forReviewSince: null });
  });

  it('refuses an illegal transition, and an Issue the Project does not hold, writing and enqueuing nothing', async () => {
    const w = world();
    const id = await newIssue(w);
    const before = await stateOf(w.issues, id);
    const historyBefore = w.issues.history.length;

    expect(await triageIssue(id, { kind: 'unresolve' }, member, deps(w))).toEqual({ refusal: 'transition_not_allowed' });
    expect(await triageIssue('issue-404', { kind: 'mark_reviewed' }, member, deps(w))).toEqual({ refusal: 'issue_not_found' });

    expect(await stateOf(w.issues, id)).toEqual(before);
    expect(w.issues.history.length).toBe(historyBefore);
    expect(w.effects.enqueued).toEqual([]);
  });
});
