import { describe, expect, it } from 'vitest';
import { moveReport } from '../../../../src/application/reports/move-report.js';
import { notifyReporters } from '../../../../src/application/reports/notify-reporters.js';
import { replyAsReporter } from '../../../../src/application/reports/reply-as-reporter.js';
import { viewFollowUp } from '../../../../src/application/reports/view-follow-up.js';
import { beginDeletion, resolve } from '../../../../src/domain/issue/commands.js';
import type { IssueChange } from '../../../../src/domain/issue/state.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { ADA, assertionOf, BOB, filed, HOUR, member, PROJECT, T0, world, type World } from './world.js';

async function issueOf(w: World, reportId: string): Promise<string> {
  const report = await w.projects.store(PROJECT).getReport(reportId);
  if (!report) throw new Error(`no report ${reportId}`);
  return report.issueId;
}

function deps(w: World) {
  return { issues: w.projects.store(PROJECT), clock: w.clock };
}

/** A Member resolves the Issue, as triageIssue would; returns the Issue Changes. */
async function resolveIssue(w: World, issueId: string): Promise<IssueChange[]> {
  const store = w.projects.store(PROJECT);
  const state = await store.getIssue(issueId);
  if (!state) throw new Error(`no issue ${issueId}`);
  const resolved = resolve(state, { kind: 'plain' }, member, w.clock.now());
  if (isRefusal(resolved)) throw new Error(resolved.refusal);
  await store.putIssue(resolved.state);
  return [...resolved.changes];
}

describe('moveReport', () => {
  it('Duplicate reports share outcome: Given two Reports moved onto one issue, When that issue is resolved, Then both Reports become Fixed and both reporters are notified', async () => {
    const w = world();
    const ada = await filed(w, ADA);
    const bob = await filed(w, BOB, 'saving fails for me too');
    const target = await issueOf(w, ada.reportId);
    const moved = await moveReport(bob.reportId, target, member, deps(w));
    if (isRefusal(moved)) throw new Error(moved.refusal);
    expect(moved.issueId).toBe(target);
    w.mailer.sent.length = 0;

    const sent = [];
    for (const change of await resolveIssue(w, target)) sent.push(...(await notifyReporters(PROJECT, change, w)));

    expect(sent.map((notice) => [notice.to, notice.about]).sort()).toEqual([
      [ADA, { status: 'fixed' }],
      [BOB, { status: 'fixed' }],
    ]);
  });

  it("a moved Report's status follows its new Issue, and its reporter's replies move with it into its own Thread only", async () => {
    const w = world();
    const ada = await filed(w, ADA);
    const bob = await filed(w, BOB, 'saving fails for me too');
    w.clock.set(T0 + HOUR);
    await replyAsReporter(bob.reference, { text: 'on firefox' }, assertionOf(BOB), w);
    const target = await issueOf(w, ada.reportId);
    await moveReport(bob.reportId, target, member, deps(w));
    await resolveIssue(w, target);

    const bobView = await viewFollowUp(bob.reference, assertionOf(BOB), w);
    const adaView = await viewFollowUp(ada.reference, assertionOf(ADA), w);
    if (isRefusal(bobView) || isRefusal(adaView)) throw new Error('refused');
    expect(bobView.status).toBe('fixed');
    expect(bobView.thread).toEqual([{ author: 'you', text: 'on firefox', at: T0 + HOUR }]);
    expect(adaView.thread).toEqual([]);
  });

  it('moving a Report onto the Issue it is on changes nothing', async () => {
    const w = world();
    const ada = await filed(w, ADA);
    const issueId = await issueOf(w, ada.reportId);

    const moved = await moveReport(ada.reportId, issueId, member, deps(w));

    expect(moved).toEqual(await w.projects.store(PROJECT).getReport(ada.reportId));
  });

  it('refuses an unknown Report, an Issue the Project does not hold, and an Issue being deleted', async () => {
    const w = world();
    const ada = await filed(w, ADA);
    const bob = await filed(w, BOB);
    const store = w.projects.store(PROJECT);
    const bobIssue = await issueOf(w, bob.reportId);
    const state = await store.getIssue(bobIssue);
    if (!state) throw new Error('no issue');
    const deleting = beginDeletion(state, member, T0);
    if (isRefusal(deleting)) throw new Error(deleting.refusal);
    await store.putIssue(deleting.state);

    expect(await moveReport('report-404', bobIssue, member, deps(w))).toEqual({ refusal: 'not-found' });
    expect(await moveReport(ada.reportId, 'issue-404', member, deps(w))).toEqual({ refusal: 'issue_not_found' });
    expect(await moveReport(ada.reportId, bobIssue, member, deps(w))).toEqual({ refusal: 'issue_deleting' });
    expect((await store.getReport(ada.reportId))?.issueId).toBe(await issueOf(w, ada.reportId));
  });
});
