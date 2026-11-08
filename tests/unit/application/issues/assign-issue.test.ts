import { describe, expect, it } from 'vitest';
import { assignEvent } from '../../../../src/application/issues/assign-event.js';
import { assignIssue } from '../../../../src/application/issues/assign-issue.js';
import { HOUR, T0, issueIdOf, summary, world } from './world.js';

const member = { member: 'member-1' };
const MIA = { member: 'member-mia' };

async function newIssue(w: ReturnType<typeof world>): Promise<string> {
  return issueIdOf(await assignEvent(summary(T0), ['fp-a'], { issues: w.issues, clock: w.clock, ids: w.ids, policies: w.policies }));
}

function deps(w: ReturnType<typeof world>) {
  return { issues: w.issues, effects: w.effects, clock: w.clock };
}

describe('assignIssue', () => {
  it('saves the Assignee, takes the Issue out of For Review, makes the assigned Member a follower and enqueues the changes', async () => {
    const w = world();
    const id = await newIssue(w);
    w.effects.enqueued.length = 0;
    w.clock.set(T0 + HOUR);

    const changes = await assignIssue(id, MIA, member, deps(w));

    expect(changes).toEqual([
      { issueId: id, kind: 'assignee', from: null, to: 'member:member-mia', actor: member, origin: 'nightwatch', at: T0 + HOUR },
      { issueId: id, kind: 'for_review', from: 'in', to: null, actor: member, origin: 'nightwatch', at: T0 + HOUR },
    ]);
    expect(await w.issues.assigneeOf(id)).toEqual(MIA);
    expect((await w.issues.getIssue(id))?.forReviewSince).toBeNull();
    expect(await w.issues.participationsOf(id)).toEqual([{ member: 'member-mia', reason: 'assigned' }]);
    expect(w.effects.enqueued).toEqual(changes);
    expect(w.issues.history.slice(-2)).toEqual(changes);
  });

  it('a Team Assignee is saved, and no Member follows for it', async () => {
    const w = world();
    const id = await newIssue(w);

    await assignIssue(id, { team: 'web' }, member, deps(w));

    expect(await w.issues.assigneeOf(id)).toEqual({ team: 'web' });
    expect(await w.issues.participationsOf(id)).toEqual([]);
  });

  it('unassigning clears the Assignee; assigning the same Member twice follows once', async () => {
    const w = world();
    const id = await newIssue(w);
    await assignIssue(id, MIA, member, deps(w));
    await assignIssue(id, MIA, member, deps(w));
    expect(await w.issues.participationsOf(id)).toEqual([{ member: 'member-mia', reason: 'assigned' }]);

    await assignIssue(id, null, member, deps(w));
    expect(await w.issues.assigneeOf(id)).toBeNull();
  });

  it('refuses an Issue the Project does not hold, and enqueues nothing', async () => {
    const w = world();
    expect(await assignIssue('issue-404', MIA, member, deps(w))).toEqual({ refusal: 'issue_not_found' });
    expect(w.effects.enqueued).toEqual([]);
  });
});
