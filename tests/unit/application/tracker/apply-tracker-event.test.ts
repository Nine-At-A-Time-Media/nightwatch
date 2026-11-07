import { describe, expect, it } from 'vitest';
import { mergeIssues } from '../../../../src/application/issues/merge-issues.js';
import { applyTrackerEvent } from '../../../../src/application/tracker/apply-tracker-event.js';
import { openExternalIssue } from '../../../../src/application/tracker/open-external-issue.js';
import { pushIssueChange } from '../../../../src/application/tracker/push-issue-change.js';
import { resolve } from '../../../../src/domain/issue/commands.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { threadOf } from '../../../../src/domain/report/thread.js';
import type { CloseReason } from '../../../../src/domain/tracker/external-link.js';
import type { TrackerEvent } from '../../../../src/domain/tracker/tracker-event.js';
import {
  ADA,
  APP,
  BOB,
  crashIssue,
  filed,
  githubDeps,
  HOUR,
  member,
  memberCommand,
  MIA_LOGIN,
  notifyAll,
  PROJECT,
  REPOSITORY,
  shownStatuses,
  T0,
  world,
  type World,
} from './world.js';

function closed(number: number, reason: CloseReason, actor = 'octocat'): TrackerEvent {
  return { kind: 'issue_closed', repository: REPOSITORY, number, reason, actor };
}

function reopened(number: number, actor = 'octocat'): TrackerEvent {
  return { kind: 'issue_reopened', repository: REPOSITORY, number, actor };
}

function commented(number: number, body: string, login = MIA_LOGIN): TrackerEvent {
  return { kind: 'comment_created', repository: REPOSITORY, number, author: { login, canWrite: true }, body };
}

/** A Report filed by Ada, its Issue linked as tracker issue 1; returns the Report and Issue ids. */
async function linkedReport(w: World): Promise<{ reportId: string; issueId: string }> {
  const receipt = await filed(w, ADA);
  const report = await w.projects.getReport(PROJECT, receipt.reportId);
  if (!report) throw new Error('no report');
  const opened = await openExternalIssue(PROJECT, report.issueId, REPOSITORY, member, githubDeps(w));
  if (isRefusal(opened)) throw new Error(opened.refusal);
  return { reportId: receipt.reportId, issueId: report.issueId };
}

async function apply(w: World, event: TrackerEvent) {
  const changes = await applyTrackerEvent(event, githubDeps(w));
  if (isRefusal(changes)) throw new Error(changes.refusal);
  return changes;
}

describe('applyTrackerEvent', () => {
  it('GitHub close resolves: Given a linked issue, When the GitHub issue is closed as completed, Then the Nightwatch issue is resolved and its Reports become Fixed', async () => {
    const w = world();
    const { reportId, issueId } = await linkedReport(w);
    w.clock.set(T0 + HOUR);

    const changes = await apply(w, closed(1, 'completed'));
    await notifyAll(w, w.effects.enqueued);

    expect(changes.find((change) => change.kind === 'status')).toMatchObject({
      to: 'resolved',
      actor: 'tracker',
      origin: 'tracker',
      at: T0 + HOUR,
    });
    expect(await w.projects.getIssue(PROJECT, issueId)).toMatchObject({ status: 'resolved', resolution: { kind: 'plain' } });
    expect(await shownStatuses(w, reportId)).toEqual(['received', 'fixed']);
    expect(await w.projects.externalLinkOf(PROJECT, issueId)).toMatchObject({ lastKnown: { state: 'closed', reason: 'completed' } });
  });

  it('GitHub not-planned closes report: Given a linked issue, When the GitHub issue is closed as not planned, Then the Nightwatch issue is archived forever and its Reports become Closed', async () => {
    const w = world();
    const { reportId, issueId } = await linkedReport(w);

    await apply(w, closed(1, 'not_planned'));
    await notifyAll(w, w.effects.enqueued);

    expect(await w.projects.getIssue(PROJECT, issueId)).toMatchObject({ status: 'archived', substatus: 'forever', spam: false });
    expect(await shownStatuses(w, reportId)).toEqual(['received', 'closed']);
  });

  it('GitHub reopen: Given a linked resolved issue, When the GitHub issue is reopened, Then the Nightwatch issue is unresolved and its Reports become Acknowledged', async () => {
    const w = world();
    const { reportId, issueId } = await linkedReport(w);
    await apply(w, closed(1, 'completed'));

    await apply(w, reopened(1));
    await notifyAll(w, w.effects.enqueued);

    expect(await w.projects.getIssue(PROJECT, issueId)).toMatchObject({ status: 'unresolved', substatus: 'ongoing' });
    expect(await shownStatuses(w, reportId)).toEqual(['received', 'acknowledged']);
  });

  it('a GitHub reopen unarchives an Issue archived forever', async () => {
    const w = world();
    const { reportId, issueId } = await linkedReport(w);
    await apply(w, closed(1, 'not_planned'));
    await notifyAll(w, w.effects.enqueued);

    await apply(w, reopened(1));
    await notifyAll(w, w.effects.enqueued);

    expect(await w.projects.getIssue(PROJECT, issueId)).toMatchObject({ status: 'unresolved', substatus: 'ongoing' });
    expect(await shownStatuses(w, reportId)).toEqual(['received', 'closed', 'acknowledged']);
  });

  it('No echo: Given a state change that came from GitHub, When Nightwatch applies it, Then Nightwatch does not send the same change back to GitHub', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    const opened = await openExternalIssue(PROJECT, issueId, REPOSITORY, member, githubDeps(w));
    if (isRefusal(opened)) throw new Error(opened.refusal);
    w.tracker.setState({ repository: REPOSITORY, number: 1 }, { state: 'closed', reason: 'completed' });

    const changes = await apply(w, closed(1, 'completed'));
    for (const change of changes) await pushIssueChange(PROJECT, change, githubDeps(w));

    expect(changes.length).toBeGreaterThan(0);
    expect(w.tracker.calls.map((call) => call.kind)).toEqual(['openIssue']);
  });

  it('No echo: the tracker reporting back a state Nightwatch pushed, or a change the App made, changes nothing', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    const opened = await openExternalIssue(PROJECT, issueId, REPOSITORY, member, githubDeps(w));
    if (isRefusal(opened)) throw new Error(opened.refusal);
    for (const change of await memberCommand(w, issueId, (state) => resolve(state, { kind: 'plain' }, member, T0))) {
      await pushIssueChange(PROJECT, change, githubDeps(w));
    }
    const history = w.projects.store(PROJECT).history.length;

    expect(await apply(w, closed(1, 'not_planned', APP))).toEqual([]);
    expect(await apply(w, closed(1, 'completed'))).toEqual([]);
    expect(w.projects.store(PROJECT).history).toHaveLength(history);
    expect(await w.projects.getIssue(PROJECT, issueId)).toMatchObject({ status: 'resolved' });
    expect(await w.projects.externalLinkOf(PROJECT, issueId)).toMatchObject({
      expected: null,
      lastKnown: { state: 'closed', reason: 'completed' },
    });
  });

  it("Shared GitHub comment: Given a linked issue with Reports, When a GitHub comment is marked for the reporter, Then it enters each Report's Thread as shared", async () => {
    const w = world();
    const ada = await filed(w, ADA);
    const bob = await filed(w, BOB);
    const adaReport = await w.projects.getReport(PROJECT, ada.reportId);
    const bobReport = await w.projects.getReport(PROJECT, bob.reportId);
    if (!adaReport || !bobReport) throw new Error('no report');
    const store = w.projects.store(PROJECT);
    await mergeIssues(adaReport.issueId, [bobReport.issueId], member, {
      issues: store,
      blobs: w.blobs,
      effects: w.effects,
      clock: w.clock,
    });
    const opened = await openExternalIssue(PROJECT, adaReport.issueId, REPOSITORY, member, githubDeps(w));
    if (isRefusal(opened)) throw new Error(opened.refusal);
    w.mailer.sent.length = 0;
    w.effects.enqueued.length = 0;

    const changes = await apply(w, commented(1, '/reporter\nA fix is on its way.'));
    const sent = await notifyAll(w, changes);

    expect(changes).toEqual([expect.objectContaining({ kind: 'comment', actor: 'tracker', origin: 'tracker' })]);
    const comments = await w.projects.commentsOn(PROJECT, adaReport.issueId);
    for (const report of [adaReport, bobReport]) {
      const stored = await w.projects.getReport(PROJECT, report.id);
      if (!stored) throw new Error('no report');
      expect(threadOf(stored, comments)).toEqual([expect.objectContaining({ author: member, shared: true, text: 'A fix is on its way.' })]);
    }
    const commentNotices = sent.filter((notification) => 'comment' in notification.about).map((notification) => notification.to);
    expect(commentNotices.sort()).toEqual([ADA, BOB].sort());
  });

  it('honours the share marker only from an author who maps to a Member, and ignores unmarked comments', async () => {
    const w = world();
    const { issueId } = await linkedReport(w);

    expect(await applyTrackerEvent(commented(1, '/reporter\nYou are owed a refund.', 'stranger'), githubDeps(w))).toEqual({
      refusal: 'not_a_member',
    });
    expect(await apply(w, commented(1, 'Internal note: looks like a race.'))).toEqual([]);
    expect(await apply(w, commented(1, '/reporter\nFrom the app.', APP))).toEqual([]);
    expect(await w.projects.commentsOn(PROJECT, issueId)).toEqual([]);
  });

  it('Uninstalled app: Given a GitHub installation is removed, When a linked issue changes, Then Nightwatch records that the link is broken and does not retry forever', async () => {
    const w = world();
    const { issueId } = await linkedReport(w);

    expect(await apply(w, { kind: 'installation_removed', repositories: [REPOSITORY] })).toEqual([]);
    const afterGitHubChange = await apply(w, closed(1, 'completed'));
    const nightwatchChanges = await memberCommand(w, issueId, (state) => resolve(state, { kind: 'plain' }, member, T0));
    for (const change of nightwatchChanges) await pushIssueChange(PROJECT, change, githubDeps(w));

    expect(afterGitHubChange).toEqual([]);
    expect(await w.projects.externalLinkOf(PROJECT, issueId)).toMatchObject({ state: 'broken' });
    expect(await w.control.isRepositoryConnected({ organizationId: 'org-1', repository: REPOSITORY })).toBe(false);
    expect(w.tracker.calls.map((call) => call.kind)).toEqual(['openIssue']);
  });

  it('breaks the links of a Repository removed from the installation, and ignores events about issues it never linked', async () => {
    const w = world();
    const { issueId } = await linkedReport(w);

    expect(await apply(w, closed(99, 'completed'))).toEqual([]);
    await apply(w, { kind: 'repository_removed', repository: REPOSITORY });

    expect(await w.projects.externalLinkOf(PROJECT, issueId)).toMatchObject({ state: 'broken' });
  });
});
