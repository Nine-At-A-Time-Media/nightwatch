import { describe, expect, it } from 'vitest';
import { notifyReporters } from '../../../../src/application/reports/notify-reporters.js';
import { eraseReporter } from '../../../../src/application/reports/erase-reporter.js';
import { replyAsReporter } from '../../../../src/application/reports/reply-as-reporter.js';
import { viewFollowUp } from '../../../../src/application/reports/view-follow-up.js';
import { fileReport } from '../../../../src/application/reports/file-report.js';
import { resolve } from '../../../../src/domain/issue/commands.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { ADA, assertionOf, BOB, filed, member, PROJECT, submission, world, type World } from './world.js';

async function adaWithHistory(w: World) {
  const withScreenshot = await fileReport(PROJECT, submission('save fails', { screenshot: new Uint8Array([1]) }), assertionOf(ADA), w);
  if (isRefusal(withScreenshot)) throw new Error(withScreenshot.refusal);
  const plain = await filed(w, ADA, 'export is empty');
  await replyAsReporter(plain.reference, { text: 'still broken, write me at ada@example.com' }, assertionOf(ADA), w);
  const bob = await filed(w, BOB, 'not mine');
  return { reports: [withScreenshot, plain], bob };
}

describe('eraseReporter', () => {
  it("Erasure: Given a reporter's erasure request, When an owner erases it, Then that reporter's Reports and contact details are gone and their Follow-up Pages say not found", async () => {
    const w = world();
    const { reports, bob } = await adaWithHistory(w);
    const store = w.projects.store(PROJECT);
    const issueIds = await Promise.all(reports.map(async (receipt) => (await store.getReport(receipt.reportId))?.issueId ?? ''));

    expect(await eraseReporter({ email: ADA }, member, w)).toEqual({ reports: 2, complete: true, incomplete: [] });

    for (const receipt of reports) expect(await viewFollowUp(receipt.reference, assertionOf(ADA), w)).toEqual({ refusal: 'not-found' });
    expect(await store.reportsBy({ email: ADA })).toEqual([]);
    for (const issueId of issueIds) {
      expect(await store.getIssue(issueId)).toBeNull();
      expect(await store.commentsOn(issueId)).toEqual([]);
    }
    expect([...w.blobs.blobs.keys()]).toEqual([]);
    expect([...w.control.references.values()].map((entry) => entry.reportId)).toEqual([bob.reportId]);
    expect(await viewFollowUp(bob.reference, assertionOf(BOB), w)).toMatchObject({ status: 'received' });
  });

  it('Erasure reaches every store: Given a reporter whose address and Reports are held in raw retention, History, the archive and pending Reporter Notifications, When an owner erases them, Then none of those holds the address or the Reports; if any cannot be erased, the owner is told the erasure is incomplete', async () => {
    const w = world();
    const { reports } = await adaWithHistory(w);
    const store = w.projects.store(PROJECT);
    const report = await store.getReport(reports[0]?.reportId ?? '');
    const state = await store.getIssue(report?.issueId ?? '');
    if (!state) throw new Error('no issue');
    const resolved = resolve(state, { kind: 'plain' }, member, w.clock.now());
    if (isRefusal(resolved)) throw new Error(resolved.refusal);
    await store.putIssue(resolved.state);
    const pending = [...resolved.changes];
    w.mailer.sent.length = 0;

    expect(await eraseReporter({ email: ADA }, member, w)).toMatchObject({ complete: true });
    for (const change of pending) expect(await notifyReporters(PROJECT, change, w)).toEqual([]);
    expect(w.mailer.sent).toEqual([]);
    expect(JSON.stringify(store.history)).not.toContain(ADA);
    expect(JSON.stringify(w.effects.enqueued)).not.toContain(ADA);

    const failing = world();
    await adaWithHistory(failing);
    failing.control.failure = { retryable: true };
    expect(await eraseReporter({ email: ADA }, member, failing)).toEqual({ reports: 2, complete: false, incomplete: ['control'] });
  });

  it('is refused to a Member who is not an Organization owner', async () => {
    const w = world();
    await filed(w, ADA);
    const plainMember = { member: 'member-plain' };
    w.control.addMembership(plainMember, { organizationId: 'org-1', role: 'member' });
    expect(await eraseReporter({ email: ADA }, plainMember, w)).toEqual({ refusal: 'not-allowed' });
    expect(await eraseReporter({ email: ADA }, { member: 'member-unknown' }, w)).toEqual({ refusal: 'not-allowed' });
    expect(await w.projects.store(PROJECT).reportsBy({ email: ADA })).toHaveLength(1);
  });
});
