import { describe, expect, it } from 'vitest';
import { applyTrackerEvent } from '../../../../src/application/tracker/apply-tracker-event.js';
import { openExternalIssue } from '../../../../src/application/tracker/open-external-issue.js';
import { pushIssueChange } from '../../../../src/application/tracker/push-issue-change.js';
import { resolve, unresolve } from '../../../../src/domain/issue/commands.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { ADA, crashIssue, filed, githubDeps, member, memberCommand, ORG, PROJECT, REPOSITORY, T0, world } from './world.js';

describe('openExternalIssue', () => {
  it('Open GitHub issue: Given a connected repository, When a member opens a GitHub issue from a Nightwatch issue, Then the GitHub issue exists with evidence and the External Link is recorded', async () => {
    const w = world();
    const issueId = await crashIssue(w, { title: 'TypeError: cart is undefined', culprit: 'app/cart' });

    const result = await openExternalIssue(PROJECT, issueId, REPOSITORY, member, githubDeps(w));

    expect(result).toEqual({
      issueId,
      repository: REPOSITORY,
      number: 1,
      state: 'linked',
      lastKnown: { state: 'open' },
      expected: null,
      refusals: 0,
    });
    const opened = w.tracker.issue({ repository: REPOSITORY, number: 1 });
    expect(opened?.state).toEqual({ state: 'open' });
    expect(opened?.draft.title).toBe('TypeError: cart is undefined');
    expect(opened?.draft.labels).toEqual(['nightwatch']);
    expect(opened?.draft.body).toContain('`app/cart`');
    expect(opened?.draft.body).toContain(`https://console.example/projects/${PROJECT}/issues/${issueId}`);
    expect(await w.projects.externalLinkOf(PROJECT, issueId)).toEqual(result);
    expect(await w.control.findLinkEntry({ repository: REPOSITORY, number: 1 })).toEqual({
      repository: REPOSITORY,
      number: 1,
      projectId: PROJECT,
      issueId,
    });
  });

  it('refuses a Repository the Organization has not connected, and sends nothing', async () => {
    const w = world();
    const issueId = await crashIssue(w);

    expect(await openExternalIssue(PROJECT, issueId, 'acme/private', member, githubDeps(w))).toEqual({
      refusal: 'repository_not_connected',
    });
    expect(w.tracker.calls).toEqual([]);
  });

  it('refuses an actor who is not a Member of the Organization', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    w.control.addMembership({ member: 'member-zed' }, { organizationId: 'org-2', role: 'owner' });

    expect(await openExternalIssue(PROJECT, issueId, REPOSITORY, { member: 'member-zed' }, githubDeps(w))).toEqual({
      refusal: 'not_a_member',
    });
    expect(await openExternalIssue(PROJECT, issueId, REPOSITORY, { member: 'member-nobody' }, githubDeps(w))).toEqual({
      refusal: 'not_a_member',
    });
    expect(w.tracker.calls).toEqual([]);
  });

  it('refuses an Issue that already has a Linked External Link, and an unknown Issue', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    expect(isRefusal(await openExternalIssue(PROJECT, issueId, REPOSITORY, member, githubDeps(w)))).toBe(false);

    expect(await openExternalIssue(PROJECT, issueId, REPOSITORY, member, githubDeps(w))).toEqual({ refusal: 'already_linked' });
    expect(await openExternalIssue(PROJECT, 'issue-404', REPOSITORY, member, githubDeps(w))).toEqual({ refusal: 'issue_not_found' });
    expect(w.tracker.calls.filter((call) => call.kind === 'openIssue')).toHaveLength(1);
  });

  it('records no External Link when the tracker refuses to open the issue', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    w.tracker.refusing = { refusal: 'tracker_refused' };

    expect(await openExternalIssue(PROJECT, issueId, REPOSITORY, member, githubDeps(w))).toEqual({ refusal: 'tracker_refused' });
    expect(await w.projects.externalLinkOf(PROJECT, issueId)).toBeNull();
    expect(await w.control.linkEntriesIn([REPOSITORY])).toEqual([]);
  });

  it('a Report issue with no Event opens under a neutral title, never the Report message', async () => {
    const w = world();
    const receipt = await filed(w, ADA, 'my card 4111 was charged twice');
    const report = await w.projects.getReport(PROJECT, receipt.reportId);
    if (!report) throw new Error('no report');

    const result = await openExternalIssue(PROJECT, report.issueId, REPOSITORY, member, githubDeps(w));

    expect(isRefusal(result)).toBe(false);
    const draft = w.tracker.issue({ repository: REPOSITORY, number: 1 })?.draft;
    expect(draft?.title).toBe('User report');
    expect(JSON.stringify(draft)).not.toContain('4111');
    expect(JSON.stringify(draft)).not.toContain(ADA);
  });

  it('Broken link relinked: Given a Broken External Link, When the installation is restored and a member relinks, Then the External Link is Linked again and later changes on either side reach the other', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    expect(isRefusal(await openExternalIssue(PROJECT, issueId, REPOSITORY, member, githubDeps(w)))).toBe(false);
    await applyTrackerEvent({ kind: 'installation_removed', repositories: [REPOSITORY] }, githubDeps(w));
    expect(await w.projects.externalLinkOf(PROJECT, issueId)).toMatchObject({ state: 'broken' });
    expect(await openExternalIssue(PROJECT, issueId, REPOSITORY, member, githubDeps(w))).toEqual({ refusal: 'repository_not_connected' });
    w.tracker.setState({ repository: REPOSITORY, number: 1 }, { state: 'closed', reason: 'completed' });

    w.control.connectRepository(ORG, REPOSITORY);
    const relinked = await openExternalIssue(PROJECT, issueId, REPOSITORY, member, githubDeps(w));

    expect(relinked).toEqual({
      issueId,
      repository: REPOSITORY,
      number: 1,
      state: 'linked',
      lastKnown: { state: 'closed', reason: 'completed' },
      expected: null,
      refusals: 0,
    });
    expect(w.tracker.calls.filter((call) => call.kind === 'openIssue')).toHaveLength(1);
    expect(await w.projects.externalLinkOf(PROJECT, issueId)).toEqual(relinked);

    for (const change of await memberCommand(w, issueId, (state) => resolve(state, { kind: 'plain' }, member, T0))) {
      await pushIssueChange(PROJECT, change, githubDeps(w));
    }
    await memberCommand(w, issueId, (state) => unresolve(state, member, T0));
    w.tracker.setState({ repository: REPOSITORY, number: 1 }, { state: 'closed', reason: 'not_planned' });
    await applyTrackerEvent(
      { kind: 'issue_closed', repository: REPOSITORY, number: 1, reason: 'not_planned', actor: 'octocat' },
      githubDeps(w),
    );

    expect(w.tracker.calls.filter((call) => call.kind === 'closeIssue')).toHaveLength(1);
    expect(await w.projects.getIssue(PROJECT, issueId)).toMatchObject({ status: 'archived', substatus: 'forever' });
  });

  it('refuses to relink a Broken External Link to another Repository', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    expect(isRefusal(await openExternalIssue(PROJECT, issueId, REPOSITORY, member, githubDeps(w)))).toBe(false);
    await applyTrackerEvent({ kind: 'repository_removed', repository: REPOSITORY }, githubDeps(w));
    w.control.connectRepository(ORG, 'acme/other');

    expect(await openExternalIssue(PROJECT, issueId, 'acme/other', member, githubDeps(w))).toEqual({ refusal: 'transition_not_allowed' });
  });
});
