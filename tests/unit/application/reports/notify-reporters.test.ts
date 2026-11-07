import { describe, expect, it } from 'vitest';
import { mergeIssues } from '../../../../src/application/issues/merge-issues.js';
import { notifyReporters } from '../../../../src/application/reports/notify-reporters.js';
import { resolve } from '../../../../src/domain/issue/commands.js';
import type { Resolution } from '../../../../src/domain/issue/resolution.js';
import type { IssueChange } from '../../../../src/domain/issue/state.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { summary } from '../issues/world.js';
import { ADA, BOB, filed, HOUR, member, PROJECT, T0, world, type World } from './world.js';

async function issueOf(w: World, reportId: string): Promise<string> {
  const report = await w.projects.store(PROJECT).getReport(reportId);
  if (!report) throw new Error(`no report ${reportId}`);
  return report.issueId;
}

/** A Member resolves the Issue, as triageIssue would; returns the Issue Changes. */
async function resolveIssue(w: World, issueId: string, resolution: Resolution): Promise<IssueChange[]> {
  const store = w.projects.store(PROJECT);
  const state = await store.getIssue(issueId);
  if (!state) throw new Error(`no issue ${issueId}`);
  const resolved = resolve(state, resolution, member, w.clock.now());
  if (isRefusal(resolved)) throw new Error(resolved.refusal);
  await store.putIssue(resolved.state);
  return [...resolved.changes];
}

async function notifyAll(w: World, changes: readonly IssueChange[]) {
  const sent = [];
  for (const change of changes) sent.push(...(await notifyReporters(PROJECT, change, w)));
  return sent;
}

async function shownStatuses(w: World, reportId: string): Promise<string[]> {
  return (await w.projects.store(PROJECT).statusChangesOf(reportId)).map((change) => change.status);
}

describe('notifyReporters', () => {
  it('Status change notifies: Given a Report whose reporter is subscribed, When its issue is resolved, Then the reporter is notified that the Report is Fixed', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    w.mailer.sent.length = 0;
    w.clock.set(T0 + HOUR);
    const changes = await resolveIssue(w, await issueOf(w, receipt.reportId), { kind: 'plain' });

    expect(await notifyAll(w, changes)).toEqual([{ reportId: receipt.reportId, to: ADA, about: { status: 'fixed' } }]);
    const mail = w.mailer.sentTo(ADA);
    expect(mail).toHaveLength(1);
    expect(mail[0]?.subject).toMatch(/fixed/i);
    expect(mail[0]?.text).toMatch(/https:\/\/console\.example\/follow-up\/[A-Za-z0-9_-]{22}/);
    expect(await w.projects.store(PROJECT).statusChangesOf(receipt.reportId)).toEqual([
      { status: 'received', at: T0 },
      { status: 'fixed', at: T0 + HOUR },
    ]);

    expect(await notifyAll(w, changes)).toEqual([]);
    expect(w.mailer.sentTo(ADA)).toHaveLength(1);
  });

  it('Fix ships: Given a Fixed Report, When the resolving release is seen, Then the Report Status becomes Released and the reporter is notified', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    await notifyAll(w, await resolveIssue(w, await issueOf(w, receipt.reportId), { kind: 'in_next_release', release: null }));
    expect(await shownStatuses(w, receipt.reportId)).toEqual(['received', 'fixed']);
    w.mailer.sent.length = 0;

    const sent = await notifyAll(w, await w.projects.recordReleaseSeen(PROJECT, '1.2.0'));
    expect(sent).toEqual([{ reportId: receipt.reportId, to: ADA, about: { status: 'released' } }]);
    expect(w.mailer.sentTo(ADA)).toHaveLength(1);
    expect(await shownStatuses(w, receipt.reportId)).toEqual(['received', 'fixed', 'released']);
  });

  it('Regression reopens a Report: Given a Fixed or Released Report, When its issue becomes Unresolved/Regressed, Then the Report Status becomes Acknowledged and the reporter is notified', async () => {
    const w = world();
    const crash = await w.projects.assignEvent(PROJECT, summary(T0, { release: '1.0.0' }), ['fp-a']);
    const crashIssue = 'issueId' in crash ? crash.issueId : '';
    const receipt = await filed(w, ADA);
    const store = w.projects.store(PROJECT);
    await mergeIssues(crashIssue, [await issueOf(w, receipt.reportId)], member, { issues: store, blobs: w.blobs, effects: w.effects, clock: w.clock });
    expect(await issueOf(w, receipt.reportId)).toBe(crashIssue);
    await w.projects.recordReleaseSeen(PROJECT, '1.0.0');
    await notifyAll(w, await resolveIssue(w, crashIssue, { kind: 'in_release', release: '1.0.0' }));
    expect(await shownStatuses(w, receipt.reportId)).toEqual(['received', 'released']);
    w.mailer.sent.length = 0;

    const regressed = await w.projects.assignEvent(PROJECT, summary(T0 + HOUR, { release: '1.1.0' }), ['fp-a']);
    expect(await store.getIssue(crashIssue)).toMatchObject({ status: 'unresolved', substatus: 'regressed' });
    const sent = await notifyAll(w, regressed.changes);
    expect(sent).toEqual([{ reportId: receipt.reportId, to: ADA, about: { status: 'acknowledged' } }]);
    expect(w.mailer.sentTo(ADA)).toHaveLength(1);
  });

  it('Duplicate reports share outcome: Given two Reports moved onto one issue, When that issue is resolved, Then both Reports become Fixed and both reporters are notified', async () => {
    const w = world();
    const ada = await filed(w, ADA);
    const bob = await filed(w, BOB, 'saving fails for me too');
    const target = await issueOf(w, ada.reportId);
    const store = w.projects.store(PROJECT);
    await mergeIssues(target, [await issueOf(w, bob.reportId)], member, { issues: store, blobs: w.blobs, effects: w.effects, clock: w.clock });
    expect((await store.reportsOn(target)).map((report) => report.id).sort()).toEqual([ada.reportId, bob.reportId].sort());
    w.mailer.sent.length = 0;

    const sent = await notifyAll(w, await resolveIssue(w, target, { kind: 'plain' }));
    expect(sent.map((notice) => [notice.to, notice.about]).sort()).toEqual([
      [ADA, { status: 'fixed' }],
      [BOB, { status: 'fixed' }],
    ]);
    expect(w.mailer.sentTo(ADA)).toHaveLength(1);
    expect(w.mailer.sentTo(BOB)).toHaveLength(1);
  });

  it('Unsubscribe: Given a reporter who unsubscribed from a Report, When its status changes, Then no Reporter Notification is sent', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    await w.control.unsubscribe(receipt.reportId);
    w.mailer.sent.length = 0;

    expect(await notifyAll(w, await resolveIssue(w, await issueOf(w, receipt.reportId), { kind: 'plain' }))).toEqual([]);
    expect(w.mailer.sent).toEqual([]);
    expect(await shownStatuses(w, receipt.reportId)).toEqual(['received', 'fixed']);
  });

  it('sends nothing for a change on an Issue the Project no longer holds', async () => {
    const w = world();
    const change: IssueChange = { issueId: 'issue-404', kind: 'status', from: null, to: 'resolved', actor: member, origin: 'nightwatch', at: T0 };
    expect(await notifyReporters(PROJECT, change, w)).toEqual([]);
  });
});
