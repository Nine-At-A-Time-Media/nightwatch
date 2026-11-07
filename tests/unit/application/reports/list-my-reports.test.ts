import { describe, expect, it } from 'vitest';
import { listMyReports } from '../../../../src/application/reports/list-my-reports.js';
import { viewFollowUp } from '../../../../src/application/reports/view-follow-up.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { isWellFormedReference } from '../../../../src/domain/report/reference.js';
import { ADA, assertionOf, BOB, filed, ORG, PROJECT, T0, world } from './world.js';

describe('listMyReports', () => {
  it('My reports: Given a signed-in reporter, When they open their report list, Then they see all and only their own Reports in that Organization, each with its Report Reference', async () => {
    const w = world();
    const first = await filed(w, ADA, 'save fails');
    const second = await filed(w, ADA, 'export is empty');
    await filed(w, BOB, 'not mine');
    w.control.addProject('org-2', 'project-2');
    w.control.addTrustedIssuer('org-2', { issuer: 'https://other.example', audiences: ['console'] });
    await w.projects.store('project-2').putReport({
      id: 'report-elsewhere',
      projectId: 'project-2',
      issueId: 'issue-elsewhere',
      reporter: { email: ADA },
      message: 'in another Organization',
      attachments: [],
      associatedEventId: null,
      filedAt: T0,
      spam: false,
      unsubscribed: false,
      referenceHash: 'hash-elsewhere',
    });

    const list = await listMyReports(assertionOf(ADA), w);
    if (isRefusal(list)) throw new Error(list.refusal);
    expect(list.reports.map((entry) => [entry.organizationId, entry.projectId, entry.reportId, entry.message, entry.status]).sort()).toEqual(
      [
        [ORG, PROJECT, first.reportId, 'save fails', 'received'],
        [ORG, PROJECT, second.reportId, 'export is empty', 'received'],
      ].sort(),
    );
    for (const entry of list.reports) {
      expect(isWellFormedReference(entry.reference)).toBe(true);
      expect(await viewFollowUp(entry.reference, assertionOf(ADA), w)).toMatchObject({ status: 'received' });
    }
  });

  it('lists nothing for an Assertion no Organization trusts', async () => {
    const w = world();
    await filed(w, ADA);
    expect(await listMyReports('assertion:forged', w)).toEqual({ refusal: 'unsigned' });
    expect(await listMyReports('assertion:mallory', w)).toEqual({ refusal: 'unsigned' });
  });
});
