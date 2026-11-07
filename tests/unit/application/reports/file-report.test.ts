import { describe, expect, it } from 'vitest';
import { fileReport } from '../../../../src/application/reports/file-report.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { isWellFormedReference } from '../../../../src/domain/report/reference.js';
import { ADA, assertionOf, filed, PROJECT, submission, T0, world, type World } from './world.js';

async function nothingFiled(w: World): Promise<void> {
  expect(w.control.references.size).toBe(0);
  expect(await w.projects.store(PROJECT).reportsBy({ email: ADA })).toEqual([]);
  expect(w.mailer.sent).toEqual([]);
  expect(w.blobs.blobs.size).toBe(0);
  expect(w.effects.enqueued).toEqual([]);
}

describe('fileReport', () => {
  it("Report filed in Nightwatch's form: Given a reporter in a product using Nightwatch's report form, When they submit a message, Then they see a Report Reference at once", async () => {
    const w = world();
    const screenshot = new Uint8Array([1, 2, 3]);
    const receipt = await fileReport(PROJECT, submission('the save button does nothing', { screenshot }), assertionOf(ADA), w);
    if (isRefusal(receipt)) throw new Error(receipt.refusal);

    expect(isWellFormedReference(receipt.reference)).toBe(true);
    expect(receipt.followUpUrl).toBe(`https://console.example/follow-up/${receipt.reference}`);
    expect(receipt.outcome).toEqual({ projectId: PROJECT, recordedAt: T0, kind: 'accepted', reason: null, category: 'feedback', quantity: 1 });

    const store = w.projects.store(PROJECT);
    const report = await store.getReport(receipt.reportId);
    expect(report).toMatchObject({
      reporter: { email: ADA },
      message: 'the save button does nothing',
      attachments: [`attachments/reports/${receipt.reportId}`],
      spam: false,
      filedAt: T0,
      referenceHash: await w.ids.hashReference(receipt.reference),
    });
    expect(w.blobs.blobs.get(`attachments/reports/${receipt.reportId}`)).toEqual(screenshot);
    expect(w.control.references.get(await w.ids.hashReference(receipt.reference))).toEqual({
      organizationId: 'org-1',
      projectId: PROJECT,
      reportId: receipt.reportId,
    });

    const issueId = report?.issueId ?? '';
    expect(await store.getIssue(issueId)).toMatchObject({ status: 'unresolved', substatus: 'new', count: 0 });
    expect(await store.fingerprintsOf(issueId)).toEqual([]);
    expect(await store.statusChangesOf(receipt.reportId)).toEqual([{ status: 'received', at: T0 }]);
    expect(w.effects.enqueued.map((change) => [change.issueId, change.kind])).toEqual([
      [issueId, 'status'],
      [issueId, 'for_review'],
    ]);
  });

  it('Report filed through an SDK widget: Given a signed-in reporter using a Sentry SDK feedback widget, When they submit, Then a Reporter Notification with the Report Reference is sent to their address', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    const mail = w.mailer.sentTo(ADA);
    expect(mail).toHaveLength(1);
    expect(mail[0]?.text).toContain(receipt.reference);
    expect(mail[0]?.text).toContain(receipt.followUpUrl);
    expect(receipt.noticeSent).toBe(true);
  });

  it('keeps the associated event on the Report as related evidence', async () => {
    const w = world();
    const receipt = await fileReport(PROJECT, submission('crashed', { associatedEventId: 'event-7' }), assertionOf(ADA), w);
    if (isRefusal(receipt)) throw new Error(receipt.refusal);
    expect(await w.projects.store(PROJECT).getReport(receipt.reportId)).toMatchObject({ associatedEventId: 'event-7', attachments: [] });
  });

  it('files the Report even when the receipt notice cannot be sent, and says so', async () => {
    const w = world();
    w.mailer.failure = { retryable: true };
    const receipt = await filed(w, ADA);
    expect(receipt.noticeSent).toBe(false);
    expect(await w.projects.store(PROJECT).getReport(receipt.reportId)).not.toBeNull();
  });

  it('Unsigned report refused: Given a submission that carries no sign-in from a trusted issuer, When it is submitted, Then no Report is filed and an invalid Outcome is recorded', async () => {
    for (const assertion of [null, 'assertion:forged', 'assertion:mallory']) {
      const w = world();
      expect(await fileReport(PROJECT, submission('it broke'), assertion, w)).toEqual({
        refusal: 'unsigned',
        outcome: { projectId: PROJECT, recordedAt: T0, kind: 'invalid', reason: 'unsigned', category: 'feedback', quantity: 1 },
      });
      await nothingFiled(w);
      expect(w.quota.requests).toEqual([]);
    }
  });

  it('refuses a Report for an unknown Project', async () => {
    const w = world();
    expect(await fileReport('project-404', submission('it broke'), assertionOf(ADA), w)).toMatchObject({ refusal: 'unknown-project' });
    await nothingFiled(w);
  });

  it('Empty message refused: Given a message that is empty, When the reporter submits, Then the Report is not filed and the form says why', async () => {
    const w = world();
    expect(await fileReport(PROJECT, submission('   '), assertionOf(ADA), w)).toEqual({
      refusal: 'empty-message',
      outcome: { projectId: PROJECT, recordedAt: T0, kind: 'invalid', reason: 'empty-message', category: 'feedback', quantity: 1 },
    });
    await nothingFiled(w);
  });

  it('Report quota: Given the Report Quota for a Project is exhausted, When a Report is submitted, Then it is refused with retry advice and an Outcome', async () => {
    const w = world({ quota: { [PROJECT]: { feedback: 1 } } });
    await filed(w, ADA);
    const refused = await fileReport(PROJECT, submission('again'), assertionOf(ADA), w);
    expect(refused).toEqual({
      refusal: 'rate-limited',
      advice: { retryAfterSeconds: 60, categories: ['feedback'], scope: 'project', reason: 'quota-exceeded' },
      outcome: { projectId: PROJECT, recordedAt: T0, kind: 'rate_limited', reason: 'quota-exceeded', category: 'feedback', quantity: 1 },
    });
    expect(w.quota.requests.map((request) => [request.projectId, request.category, request.quantity])).toEqual([
      [PROJECT, 'feedback', 1],
      [PROJECT, 'feedback', 1],
    ]);
    expect(await w.projects.store(PROJECT).reportsBy({ email: ADA })).toHaveLength(1);
  });

  it('Failed send is visible: Given storage is unavailable, When the reporter submits, Then the Report is not filed and the refusal says to retry', async () => {
    const blobsDown = world();
    blobsDown.blobs.failure = { retryable: true };
    const screenshot = new Uint8Array([9]);
    expect(await fileReport(PROJECT, submission('it broke', { screenshot }), assertionOf(ADA), blobsDown)).toEqual({
      refusal: 'unavailable',
      retryable: true,
    });
    await nothingFiled(blobsDown);

    const controlDown = world();
    controlDown.control.failure = { retryable: true };
    expect(await fileReport(PROJECT, submission('it broke'), assertionOf(ADA), controlDown)).toEqual({ refusal: 'unavailable', retryable: true });
    await nothingFiled(controlDown);
  });

  it('archives a Report the Spam Judge judges spam at the threshold, and still sends the receipt as for any Report', async () => {
    const w = world();
    w.spam.verdict = { verdict: 'spam', confidence: 0.95 };
    const receipt = await filed(w, ADA, 'buy cheap watches');
    const store = w.projects.store(PROJECT);
    const report = await store.getReport(receipt.reportId);
    expect(w.spam.judged).toEqual(['buy cheap watches']);
    expect(report).toMatchObject({ spam: true });
    expect(await store.getIssue(report?.issueId ?? '')).toMatchObject({ status: 'archived', substatus: 'forever', spam: true });
    expect(w.mailer.sentTo(ADA)).toHaveLength(1);
  });

  it('leaves a Report the Spam Judge is not sure of', async () => {
    const w = world();
    w.spam.verdict = { verdict: 'spam', confidence: 0.5 };
    const receipt = await filed(w, ADA);
    const report = await w.projects.store(PROJECT).getReport(receipt.reportId);
    expect(report).toMatchObject({ spam: false });
    expect(await w.projects.store(PROJECT).getIssue(report?.issueId ?? '')).toMatchObject({ status: 'unresolved' });
  });
});
