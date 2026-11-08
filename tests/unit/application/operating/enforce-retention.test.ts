// enforceRetention -- the ProjectDO sweep that deletes what is past its
// retention window, driven by its architecture signature over the
// in-memory IssueStore and BlobStore.
import { describe, expect, it } from 'vitest';
import { assignEvent } from '../../../../src/application/issues/assign-event.js';
import { enforceRetention } from '../../../../src/application/operating/enforce-retention.js';
import { eventBlobKey } from '../../../../src/domain/event/event-summary.js';
import type { Report } from '../../../../src/domain/report/report.js';
import type { RetentionPolicy } from '../../../../src/domain/retention/retention.js';
import { DAY, T0, issueIdOf, summary, world } from '../issues/world.js';

const PROJECT = 'project-1';

const retention: RetentionPolicy = {
  raw: 7 * DAY,
  event: 90 * DAY,
  attachment: 30 * DAY,
  report: 180 * DAY,
  outcome: 90 * DAY,
  history: 90 * DAY,
};

function report(overrides: Partial<Report> & { id: string; issueId: string; filedAt: number }): Report {
  return {
    projectId: PROJECT,
    reporter: { email: 'ada@example.com' },
    message: 'checkout broke',
    attachments: [`attachments/${PROJECT}/${overrides.id}/screenshot.png`],
    associatedEventId: null,
    spam: false,
    unsubscribed: false,
    referenceHash: `hash-${overrides.id}`,
    ...overrides,
  };
}

function assignDeps(w: ReturnType<typeof world>) {
  return { issues: w.issues, clock: w.clock, ids: w.ids, policies: w.policies };
}

function deps(w: ReturnType<typeof world>) {
  return { issues: w.issues, blobs: w.blobs, clock: w.clock, retention };
}

async function storeEventBlob(w: ReturnType<typeof world>, eventId: string): Promise<void> {
  await w.blobs.put(eventBlobKey({ projectId: PROJECT, eventId }), new Uint8Array([1]));
}

describe('enforceRetention', () => {
  it('Retention expiry: Given an event older than Event Retention, When anyone asks for it, Then it is not found', async () => {
    const w = world();
    const old = summary(T0);
    const recent = summary(T0 + 60 * DAY);
    const kept = issueIdOf(await assignEvent(old, ['kept'], assignDeps(w)));
    await assignEvent(recent, ['kept'], assignDeps(w));
    const gone = issueIdOf(await assignEvent(summary(T0 + DAY), ['gone'], assignDeps(w)));
    for (const event of [old, recent]) await storeEventBlob(w, event.eventId);
    w.clock.set(T0 + 120 * DAY);

    const expiry = await enforceRetention(PROJECT, deps(w));

    expect((await w.issues.eventsOf(kept)).map((event) => event.summary.eventId)).toEqual([recent.eventId]);
    expect(await w.blobs.get(eventBlobKey({ projectId: PROJECT, eventId: old.eventId }))).toBeNull();
    expect(await w.blobs.get(eventBlobKey({ projectId: PROJECT, eventId: recent.eventId }))).not.toBeNull();
    expect(await w.issues.getIssue(gone)).toBeNull();
    expect(await w.issues.getIssue(kept)).not.toBeNull();
    expect(expiry).toEqual({ events: 2, issues: 1, reports: 0 });
  });

  it('removes Reports past Report Retention with their Attachments and filing records, and keeps the Issue a live Report holds', async () => {
    const w = world();
    const issueId = issueIdOf(await assignEvent(summary(T0), ['report'], assignDeps(w)));
    const expired = report({ id: 'report-old', issueId, filedAt: T0 });
    const live = report({ id: 'report-live', issueId, filedAt: T0 + 150 * DAY });
    for (const held of [expired, live]) {
      await w.issues.putReport(held);
      await w.issues.recordFiling(`key-${held.id}`, { reportId: held.id, noticeSent: true });
      for (const key of held.attachments) await w.blobs.put(key, new Uint8Array([2]));
    }
    w.clock.set(T0 + 181 * DAY);

    const expiry = await enforceRetention(PROJECT, deps(w));

    expect(await w.issues.getReport(expired.id)).toBeNull();
    expect(await w.issues.recallFiling(`key-${expired.id}`)).toBeNull();
    expect(await w.blobs.get(expired.attachments[0] ?? '')).toBeNull();
    expect(await w.issues.getReport(live.id)).toEqual(live);
    expect(await w.issues.recallFiling(`key-${live.id}`)).toEqual({ reportId: live.id, noticeSent: true });
    expect(await w.issues.getIssue(issueId)).not.toBeNull();
    expect(expiry).toEqual({ events: 1, issues: 0, reports: 1 });
  });

  it('a second pass at the same moment removes nothing more', async () => {
    const w = world();
    await assignEvent(summary(T0), ['once'], assignDeps(w));
    w.clock.set(T0 + 100 * DAY);
    await enforceRetention(PROJECT, deps(w));
    expect(await enforceRetention(PROJECT, deps(w))).toEqual({ events: 0, issues: 0, reports: 0 });
  });
});
