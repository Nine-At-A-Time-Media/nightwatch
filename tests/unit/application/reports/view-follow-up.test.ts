import { describe, expect, it } from 'vitest';
import { viewFollowUp } from '../../../../src/application/reports/view-follow-up.js';
import { encodeReference } from '../../../../src/domain/report/reference.js';
import { ADA, assertionOf, EVE, filed, HOUR, MIA, PROJECT, T0, world, type World } from './world.js';

async function seedThread(w: World, reportId: string): Promise<void> {
  const store = w.projects.store(PROJECT);
  const report = await store.getReport(reportId);
  const issueId = report?.issueId ?? '';
  await store.appendComment(issueId, { id: 'c-private', author: { member: 'member-mia' }, shared: false, text: 'cache bug?', at: T0 + HOUR });
  await store.appendComment(issueId, { id: 'c-shared', author: { member: 'member-mia' }, shared: true, text: 'we are on it', at: T0 + 2 * HOUR });
  await store.appendComment(issueId, { id: 'c-reply', author: { report: reportId }, shared: true, text: 'thanks', at: T0 + 3 * HOUR });
  await store.recordStatusChange(reportId, { status: 'acknowledged', at: T0 + 2 * HOUR });
}

const EXPECTED_VIEW = {
  status: 'acknowledged',
  thread: [
    { author: 'team', text: 'we are on it', at: T0 + 2 * HOUR },
    { author: 'you', text: 'thanks', at: T0 + 3 * HOUR },
  ],
  changes: [
    { status: 'received', at: T0 },
    { status: 'acknowledged', at: T0 + 2 * HOUR },
  ],
};

describe('viewFollowUp', () => {
  it('Follow-up Page shows status: Given a Report Reference, When its reporter opens its Follow-up Page, Then they see the Report Status, the shared Thread and change dates, and nothing else about the issue', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    await seedThread(w, receipt.reportId);
    expect(await viewFollowUp(receipt.reference, assertionOf(ADA), w)).toEqual(EXPECTED_VIEW);
  });

  it('opens for a Member of the Report Project as well', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    await seedThread(w, receipt.reportId);
    expect(await viewFollowUp(receipt.reference, assertionOf(MIA), w)).toEqual(EXPECTED_VIEW);
  });

  it('Follow-up Page refuses others: Given a Report Reference, When a signed-in person who is neither its reporter nor a Member of its Project opens it, Then the page says it was not found', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    expect(await viewFollowUp(receipt.reference, assertionOf(EVE), w)).toEqual({ refusal: 'not-found' });
    expect(await viewFollowUp(receipt.reference, 'assertion:mallory', w)).toEqual({ refusal: 'not-found' });
    expect(await viewFollowUp(receipt.reference, 'assertion:forged', w)).toEqual({ refusal: 'not-found' });
  });

  it('Unknown reference: Given a reference that does not exist or was revoked, When its Follow-up Page is opened, Then the page says it was not found and reveals nothing else', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    const unknown = encodeReference(new Uint8Array(16).fill(7)) ?? '';
    expect(await viewFollowUp(unknown, assertionOf(ADA), w)).toEqual({ refusal: 'not-found' });
    expect(await viewFollowUp('not a reference', assertionOf(ADA), w)).toEqual({ refusal: 'not-found' });
    await w.control.forgetReport(receipt.reportId);
    expect(await viewFollowUp(receipt.reference, assertionOf(ADA), w)).toEqual({ refusal: 'not-found' });
  });
});
