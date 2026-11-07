/**
 * enforceRetention -- the ProjectDO sweep that removes what is past its
 * retention window (design Behaviors: Retention expiry; Retention and data
 * handling: Expiry, Order; architecture Retention, archive and usage:
 * ProjectDO deletes expired rows on its sweep alarm).
 *
 * In one IssueStore transaction: Reports filed before Report Retention's
 * cutoff are removed with their filing records; Events before Event
 * Retention's cutoff are removed; then each Issue last seen before that
 * cutoff and holding no Report is removed. Afterwards the removed Events'
 * stored copies and the removed Reports' Attachments are deleted from the
 * BlobStore. R2 lifecycle rules expire the same prefixes as a backstop; a
 * blob left behind by a failed delete is unreachable, since nothing names
 * it any more.
 *
 * Ports: IssueStore, BlobStore, Clock.
 */

import { eventBlobKey } from '../../domain/event/event-summary.js';
import type { EventId, ProjectId } from '../../domain/ids.js';
import type { Report } from '../../domain/report/report.js';
import { isExpiredIssue, retentionCutoff, type Expiry, type RetentionPolicy } from '../../domain/retention/retention.js';
import type { BlobStore } from '../../ports/blob-store.js';
import type { Clock } from '../../ports/clock.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type EnforceRetentionDeps = { issues: IssueStore; blobs: BlobStore; clock: Clock; retention: RetentionPolicy };

type Cutoffs = { readonly event: number; readonly report: number };

/** What the store pass removed, and the blobs that now name nothing. */
type Removed = { readonly expiry: Expiry; readonly blobKeys: readonly string[] };

// --- flow: the store ---

async function removeReports(cutoff: number, issues: IssueStore): Promise<readonly Report[]> {
  const expired = await issues.reportsFiledBefore(cutoff);
  for (const report of expired) await issues.removeReport(report.id);
  await issues.forgetFilingsOf(expired.map((report) => report.id));
  return expired;
}

async function removeIssues(eventCutoff: number, issues: IssueStore): Promise<number> {
  let removed = 0;
  for (const state of await issues.listIssues()) {
    const reports = (await issues.reportsOn(state.issueId)).length;
    if (!isExpiredIssue({ lastSeen: state.lastSeen, reports, eventCutoff })) continue;
    await issues.removeIssue(state.issueId);
    removed += 1;
  }
  return removed;
}

async function removeExpired(project: ProjectId, cutoffs: Cutoffs, issues: IssueStore): Promise<Removed> {
  const reports = await removeReports(cutoffs.report, issues);
  const events: readonly EventId[] = await issues.removeEventsBefore(cutoffs.event);
  const removedIssues = await removeIssues(cutoffs.event, issues);
  const eventKeys = events.map((eventId) => eventBlobKey({ projectId: project, eventId }));
  return {
    expiry: { events: events.length, issues: removedIssues, reports: reports.length },
    blobKeys: [...eventKeys, ...reports.flatMap((report) => report.attachments)],
  };
}

// --- flow: the blobs ---

async function deleteBlobs(keys: readonly string[], blobs: BlobStore): Promise<void> {
  for (const key of keys) await blobs.delete(key);
}

// --- exports ---

export async function enforceRetention(project: ProjectId, deps: EnforceRetentionDeps): Promise<Expiry> {
  const now = deps.clock.now();
  const cutoffs: Cutoffs = {
    event: retentionCutoff({ window: deps.retention.event, now }),
    report: retentionCutoff({ window: deps.retention.report, now }),
  };
  const removed = await deps.issues.transact(() => removeExpired(project, cutoffs, deps.issues));
  await deleteBlobs(removed.blobKeys, deps.blobs);
  return removed.expiry;
}
