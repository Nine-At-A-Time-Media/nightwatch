import { describe, expect, it } from 'vitest';
import { addComment } from '../../../../src/application/reports/add-comment.js';
import { notifyReporters } from '../../../../src/application/reports/notify-reporters.js';
import { viewFollowUp } from '../../../../src/application/reports/view-follow-up.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { ADA, assertionOf, filed, HOUR, member, PROJECT, T0, world, type World } from './world.js';

async function commentOnReport(w: World, reportId: string, comment: { text: string; shared: boolean }) {
  const issues = w.projects.store(PROJECT);
  const report = await issues.getReport(reportId);
  w.effects.enqueued.length = 0;
  w.mailer.sent.length = 0;
  w.clock.set(T0 + HOUR);
  return addComment(report?.issueId ?? '', comment, member, { issues, effects: w.effects, clock: w.clock, ids: w.ids });
}

async function threadOf(w: World, reference: string) {
  const view = await viewFollowUp(reference, assertionOf(ADA), w);
  if (isRefusal(view)) throw new Error(view.refusal);
  return view;
}

describe('addComment', () => {
  it('Shared reply reaches reporter: Given a team member comments and marks it shared, When the comment is saved, Then it appears in the Thread and the reporter is notified', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    const changes = await commentOnReport(w, receipt.reportId, { text: 'a fix is on its way', shared: true });

    expect(changes).toEqual([expect.objectContaining({ kind: 'comment', actor: member, at: T0 + HOUR })]);
    expect(w.effects.enqueued).toEqual(changes);
    for (const change of changes) await notifyReporters(PROJECT, change, w);
    expect(w.mailer.sentTo(ADA).some((mail) => mail.text.includes('a fix is on its way'))).toBe(true);
    expect((await threadOf(w, receipt.reference)).thread).toEqual([{ author: 'team', text: 'a fix is on its way', at: T0 + HOUR }]);
  });

  it('Private comment stays private: Given a team member comments without marking it shared, When the comment is saved, Then the reporter is told nothing and the Thread does not change', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    const before = await threadOf(w, receipt.reference);
    const changes = await commentOnReport(w, receipt.reportId, { text: 'probably the cache', shared: false });

    expect(changes).toHaveLength(1);
    for (const change of changes) expect(await notifyReporters(PROJECT, change, w)).toEqual([]);
    expect(w.mailer.sent).toEqual([]);
    expect(await threadOf(w, receipt.reference)).toEqual(before);
  });

  it('saves nothing on an Issue the Project does not hold', async () => {
    const w = world();
    const issues = w.projects.store(PROJECT);
    expect(await addComment('issue-404', { text: 'hello', shared: true }, member, { issues, effects: w.effects, clock: w.clock, ids: w.ids })).toEqual([]);
    expect(await issues.commentsOn('issue-404')).toEqual([]);
  });
});
