import { describe, expect, it } from 'vitest';
import { fileReport } from '../../../../src/application/reports/file-report.js';
import { replyAsReporter } from '../../../../src/application/reports/reply-as-reporter.js';
import { openExternalIssue } from '../../../../src/application/tracker/open-external-issue.js';
import { pushIssueChange } from '../../../../src/application/tracker/push-issue-change.js';
import { archive, resolve, unresolve } from '../../../../src/domain/issue/commands.js';
import type { IssueChange } from '../../../../src/domain/issue/state.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import type { ExternalLink } from '../../../../src/domain/tracker/external-link.js';
import { assertionOf, submission } from '../reports/world.js';
import {
  ADA,
  crashIssue,
  filed,
  githubDeps,
  HOUR,
  member,
  memberCommand,
  notifyAll,
  PROJECT,
  REPOSITORY,
  shownStatuses,
  T0,
  world,
  type World,
} from './world.js';

async function linked(w: World, issueId: string): Promise<ExternalLink> {
  const opened = await openExternalIssue(PROJECT, issueId, REPOSITORY, member, githubDeps(w));
  if (isRefusal(opened)) throw new Error(opened.refusal);
  return opened;
}

async function pushAll(w: World, changes: readonly IssueChange[]): Promise<(ExternalLink | { refusal: string })[]> {
  const results = [];
  for (const change of changes) results.push(await pushIssueChange(PROJECT, change, githubDeps(w)));
  return results;
}

function trackerWrites(w: World) {
  return w.tracker.calls.filter((call) => call.kind === 'closeIssue' || call.kind === 'reopenIssue');
}

describe('pushIssueChange', () => {
  it('Nightwatch resolve closes GitHub: Given a linked issue, When a member resolves it in Nightwatch, Then the GitHub issue is closed', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    await linked(w, issueId);
    w.clock.set(T0 + HOUR);

    await pushAll(w, await memberCommand(w, issueId, (state) => resolve(state, { kind: 'plain' }, member, w.clock.now())));

    expect(w.tracker.issue({ repository: REPOSITORY, number: 1 })?.state).toEqual({ state: 'closed', reason: 'completed' });
    expect(trackerWrites(w)).toEqual([{ kind: 'closeIssue', issue: { repository: REPOSITORY, number: 1 }, reason: 'completed' }]);
    expect(await w.projects.externalLinkOf(PROJECT, issueId)).toMatchObject({
      state: 'linked',
      lastKnown: { state: 'closed', reason: 'completed' },
      expected: { state: 'closed', reason: 'completed' },
      refusals: 0,
    });
  });

  it('closes as not planned an Issue archived forever, and reopens one a member unresolves', async () => {
    const w = world();
    const archived = await crashIssue(w);
    const resolved = await crashIssue(w);
    await linked(w, archived);
    await linked(w, resolved);

    await pushAll(w, await memberCommand(w, archived, (state) => archive(state, { substatus: 'forever', spam: false }, member, T0)));
    await pushAll(w, await memberCommand(w, resolved, (state) => resolve(state, { kind: 'plain' }, member, T0)));
    await pushAll(w, await memberCommand(w, resolved, (state) => unresolve(state, member, T0)));

    expect(w.tracker.issue({ repository: REPOSITORY, number: 1 })?.state).toEqual({ state: 'closed', reason: 'not_planned' });
    expect(w.tracker.issue({ repository: REPOSITORY, number: 2 })?.state).toEqual({ state: 'open' });
    expect(trackerWrites(w).map((call) => call.kind)).toEqual(['closeIssue', 'closeIssue', 'reopenIssue']);
  });

  it('GitHub refuses a close: Given a linked issue, When a member resolves it and GitHub refuses the close, Then the Nightwatch issue stays resolved, its Reports become Fixed, and the refusal counts toward the External Link becoming Broken', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    const report = await w.projects.getReport(PROJECT, receipt.reportId);
    if (!report) throw new Error('no report');
    await linked(w, report.issueId);
    w.tracker.refusing = { refusal: 'tracker_refused' };

    const changes = await memberCommand(w, report.issueId, (state) => resolve(state, { kind: 'plain' }, member, T0 + HOUR));
    await pushAll(w, changes);
    await notifyAll(w, changes);

    expect((await w.projects.getIssue(PROJECT, report.issueId))?.status).toBe('resolved');
    expect(await shownStatuses(w, receipt.reportId)).toEqual(['received', 'fixed']);
    expect(await w.projects.externalLinkOf(PROJECT, report.issueId)).toMatchObject({ state: 'linked', refusals: 1 });
  });

  it('breaks the External Link once refusals reach the bound, and pushes nothing after that', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    await linked(w, issueId);
    w.tracker.refusing = { refusal: 'tracker_unreachable' };

    for (let i = 0; i < 3; i += 1) {
      await pushAll(w, await memberCommand(w, issueId, (state) => resolve(state, { kind: 'plain' }, member, T0)));
      await memberCommand(w, issueId, (state) => unresolve(state, member, T0));
    }
    const attempts = trackerWrites(w).length;
    await pushAll(w, await memberCommand(w, issueId, (state) => resolve(state, { kind: 'plain' }, member, T0)));

    expect(attempts).toBe(3);
    expect(trackerWrites(w)).toHaveLength(3);
    expect(await w.projects.externalLinkOf(PROJECT, issueId)).toMatchObject({ state: 'broken', refusals: 3 });
  });

  it("Contact never leaves: Given a Report, When anything is posted to GitHub, Then the reporter's address is absent", async () => {
    const w = world();
    const receipt = await fileReport(
      PROJECT,
      submission('ada@example.com sees a blank page', { screenshot: new Uint8Array([1, 2, 3]) }),
      assertionOf(ADA),
      w,
    );
    if (isRefusal(receipt)) throw new Error(receipt.refusal);
    const report = await w.projects.getReport(PROJECT, receipt.reportId);
    if (!report) throw new Error('no report');
    expect(report.attachments).toHaveLength(1);

    await linked(w, report.issueId);
    await pushAll(w, await memberCommand(w, report.issueId, (state) => resolve(state, { kind: 'plain' }, member, T0)));
    await pushAll(w, await memberCommand(w, report.issueId, (state) => unresolve(state, member, T0)));

    const sent = JSON.stringify(w.tracker.calls);
    expect(w.tracker.calls.map((call) => call.kind)).toEqual(['openIssue', 'closeIssue', 'reopenIssue']);
    expect(sent).not.toContain(ADA);
    expect(sent).not.toContain('blank page');
    for (const key of report.attachments) expect(sent).not.toContain(key);
  });

  it("posts nothing for a Member's Comment, and counts a refused reply post toward the link becoming Broken", async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    const issueId = (await w.projects.getReport(PROJECT, receipt.reportId))?.issueId ?? '';
    await linked(w, issueId);
    w.effects.enqueued.length = 0;
    await w.projects.addComment(PROJECT, issueId, { text: 'looking', shared: true }, member);
    await pushAll(w, w.effects.enqueued);
    expect(w.tracker.calls.map((call) => call.kind)).toEqual(['openIssue']);

    w.effects.enqueued.length = 0;
    await replyAsReporter(receipt.reference, { text: 'still broken' }, assertionOf(ADA), w);
    w.tracker.refusing = { refusal: 'tracker_refused' };
    await pushAll(w, w.effects.enqueued);

    expect(await w.projects.externalLinkOf(PROJECT, issueId)).toMatchObject({ state: 'linked', refusals: 1 });
  });

  it('posts a reply to a Broken link never, and breaks the link when its Repository is no longer connected', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    const issueId = (await w.projects.getReport(PROJECT, receipt.reportId))?.issueId ?? '';
    await linked(w, issueId);
    await w.control.disconnectRepositories([REPOSITORY]);
    w.effects.enqueued.length = 0;
    await replyAsReporter(receipt.reference, { text: 'still broken' }, assertionOf(ADA), w);

    await pushAll(w, w.effects.enqueued);
    await pushAll(w, w.effects.enqueued);

    expect(w.tracker.calls.map((call) => call.kind)).toEqual(['openIssue']);
    expect(await w.projects.externalLinkOf(PROJECT, issueId)).toMatchObject({ state: 'broken' });
  });

  it('pushes nothing for a change that came from the tracker, or for an Issue with no External Link', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    const fromTracker: IssueChange = {
      issueId,
      kind: 'status',
      from: 'unresolved/new',
      to: 'resolved',
      actor: 'tracker',
      origin: 'tracker',
      at: T0,
    };

    expect(await pushIssueChange(PROJECT, fromTracker, githubDeps(w))).toEqual({ refusal: 'not_linked' });
    const externalLink = await linked(w, issueId);
    expect(await pushIssueChange(PROJECT, fromTracker, githubDeps(w))).toEqual(externalLink);
    expect(trackerWrites(w)).toEqual([]);
  });

  it('breaks the External Link without calling the tracker once its Repository is no longer connected', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    await linked(w, issueId);
    await w.control.disconnectRepositories([REPOSITORY]);

    const [result] = await pushAll(w, await memberCommand(w, issueId, (state) => resolve(state, { kind: 'plain' }, member, T0)));

    expect(result).toMatchObject({ state: 'broken' });
    expect(trackerWrites(w)).toEqual([]);
  });
});
