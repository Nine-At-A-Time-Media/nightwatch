import { describe, expect, it } from 'vitest';
import { mergeIssues } from '../../../../src/application/issues/merge-issues.js';
import { markSpam } from '../../../../src/application/reports/mark-spam.js';
import { notifyReporters } from '../../../../src/application/reports/notify-reporters.js';
import { viewFollowUp } from '../../../../src/application/reports/view-follow-up.js';
import { summary } from '../issues/world.js';
import { ADA, assertionOf, filed, HOUR, member, PROJECT, T0, world } from './world.js';

describe('markSpam', () => {
  it('Spam is silent: Given a Report, When it is marked spam, Then it is archived, its reporter is told nothing, and its Follow-up Page does not change', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    const store = w.projects.store(PROJECT);
    const before = await viewFollowUp(receipt.reference, assertionOf(ADA), w);
    w.mailer.sent.length = 0;
    w.clock.set(T0 + HOUR);

    const changes = await markSpam(receipt.reportId, member, { issues: store, clock: w.clock });
    const issueId = (await store.getReport(receipt.reportId))?.issueId ?? '';
    expect(changes).toContainEqual(expect.objectContaining({ issueId, kind: 'status', to: 'archived/forever', actor: member }));
    expect(await store.getIssue(issueId)).toMatchObject({ status: 'archived', substatus: 'forever', spam: true });
    expect(await store.getReport(receipt.reportId)).toMatchObject({ spam: true });

    for (const change of changes) expect(await notifyReporters(PROJECT, change, w)).toEqual([]);
    expect(w.mailer.sent).toEqual([]);
    expect(await viewFollowUp(receipt.reference, assertionOf(ADA), w)).toEqual(before);
  });

  it('archives on a spam verdict as the Spam Judge, and ignores any other verdict', async () => {
    const w = world();
    const store = w.projects.store(PROJECT);
    const unsure = await filed(w, ADA);
    expect(await markSpam(unsure.reportId, { verdict: 'not_spam', confidence: 0.99 }, { issues: store, clock: w.clock })).toEqual([]);
    expect(await store.getReport(unsure.reportId)).toMatchObject({ spam: false });

    const judged = await filed(w, ADA, 'buy now');
    const changes = await markSpam(judged.reportId, { verdict: 'spam', confidence: 0.97 }, { issues: store, clock: w.clock });
    expect(changes).toContainEqual(expect.objectContaining({ kind: 'status', to: 'archived/forever', actor: 'spam_judge' }));
  });

  it('marks only the Report, not a crash Issue it was moved onto', async () => {
    const w = world();
    const store = w.projects.store(PROJECT);
    const crash = await w.projects.assignEvent(PROJECT, summary(T0), ['fp-a']);
    const crashIssue = 'issueId' in crash ? crash.issueId : '';
    const receipt = await filed(w, ADA);
    const reportIssue = (await store.getReport(receipt.reportId))?.issueId ?? '';
    await mergeIssues(crashIssue, [reportIssue], member, { issues: store, blobs: w.blobs, effects: w.effects, clock: w.clock });

    expect(await markSpam(receipt.reportId, member, { issues: store, clock: w.clock })).toEqual([]);
    expect(await store.getReport(receipt.reportId)).toMatchObject({ spam: true });
    expect(await store.getIssue(crashIssue)).toMatchObject({ status: 'unresolved' });
  });

  it('changes nothing for an unknown Report', async () => {
    const w = world();
    expect(await markSpam('report-404', member, { issues: w.projects.store(PROJECT), clock: w.clock })).toEqual([]);
  });
});
