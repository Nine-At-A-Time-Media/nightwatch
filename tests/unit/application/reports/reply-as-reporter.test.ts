import { describe, expect, it } from 'vitest';
import { notifyReporters } from '../../../../src/application/reports/notify-reporters.js';
import { replyAsReporter } from '../../../../src/application/reports/reply-as-reporter.js';
import { openExternalIssue } from '../../../../src/application/tracker/open-external-issue.js';
import { pushIssueChange } from '../../../../src/application/tracker/push-issue-change.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { githubDeps, REPOSITORY, world as githubWorld } from '../tracker/world.js';
import { ADA, assertionOf, EVE, filed, HOUR, member, MIA, PROJECT, T0, world } from './world.js';

describe('replyAsReporter', () => {
  it('Reporter reply reaches team: Given a Report Thread, When the reporter replies, Then the reply appears on the issue for the team, and on the linked GitHub issue without contact details', async () => {
    const w = githubWorld();
    const receipt = await filed(w, ADA);
    const issueId = (await w.projects.store(PROJECT).getReport(receipt.reportId))?.issueId ?? '';
    const opened = await openExternalIssue(PROJECT, issueId, REPOSITORY, member, githubDeps(w));
    if (isRefusal(opened)) throw new Error(opened.refusal);
    await w.projects.recordShownStatus(PROJECT, receipt.reportId, { status: 'acknowledged', at: T0 });
    w.effects.enqueued.length = 0;
    w.mailer.sent.length = 0;
    w.clock.set(T0 + HOUR);
    const text = 'it also happens on mobile; mail me at ADA@example.com';

    const changes = await replyAsReporter(receipt.reference, { text }, assertionOf(ADA), w);
    if (isRefusal(changes)) throw new Error(changes.refusal);

    expect(changes).toEqual([expect.objectContaining({ issueId, kind: 'comment', actor: 'reporter', at: T0 + HOUR })]);
    expect(await w.projects.store(PROJECT).commentsOn(issueId)).toEqual([
      expect.objectContaining({ author: { report: receipt.reportId }, shared: true, text, at: T0 + HOUR }),
    ]);
    expect(w.effects.enqueued).toEqual(changes);
    expect(JSON.stringify(w.effects.enqueued)).not.toContain(ADA);
    for (const change of changes) expect(await notifyReporters(PROJECT, change, w)).toEqual([]);
    expect(w.mailer.sent).toEqual([]);

    for (const change of w.effects.enqueued) await pushIssueChange(PROJECT, change, githubDeps(w));
    const posted = w.tracker.issue({ repository: REPOSITORY, number: opened.number })?.comments ?? [];
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain('it also happens on mobile');
    expect(JSON.stringify(w.tracker.calls).toLowerCase()).not.toContain(ADA);
  });

  it('takes replies from the Report Reporter only, and refuses unknown references and blank replies', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    w.effects.enqueued.length = 0;
    expect(await replyAsReporter(receipt.reference, { text: 'hi' }, assertionOf(EVE), w)).toEqual({ refusal: 'not-found' });
    expect(await replyAsReporter(receipt.reference, { text: 'hi' }, assertionOf(MIA), w)).toEqual({ refusal: 'not-found' });
    expect(await replyAsReporter('AAAAAAAAAAAAAAAAAAAAAA', { text: 'hi' }, assertionOf(ADA), w)).toEqual({ refusal: 'not-found' });
    expect(await replyAsReporter(receipt.reference, { text: '  ' }, assertionOf(ADA), w)).toEqual({ refusal: 'empty-message' });
    expect(w.effects.enqueued).toEqual([]);
  });
});
