/**
 * discardIssue -- a Member discards an Issue (design Behaviors: Discard;
 * Issues, Discard; Grouping, Tombstones). In one IssueStore transaction the
 * Issue moves to Deleting, a Tombstone keeps its Fingerprints, and the Issue
 * is removed with its Events; later Events with those Fingerprints are then
 * dropped by assignEvent. The stored Events are deleted from the BlobStore
 * once the transaction has settled. Ports: IssueStore, BlobStore, Clock;
 * `projectId` is the Project whose IssueStore this is, which keys its
 * stored Events.
 */

import { eventBlobKey } from '../../domain/event/event-summary.js';
import type { IssueId, ProjectId } from '../../domain/ids.js';
import { beginDeletion } from '../../domain/issue/commands.js';
import { issueNotFound, type IssueChange, type Member } from '../../domain/issue/state.js';
import { isRefusal, type Refusal } from '../../domain/refusal.js';
import type { BlobStore } from '../../ports/blob-store.js';
import type { Clock } from '../../ports/clock.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type DiscardIssueDeps = { projectId: ProjectId; issues: IssueStore; blobs: BlobStore; clock: Clock };

type Discard = { projectId: ProjectId; issue: IssueId; actor: Member; at: number };
type Discarded = { changes: IssueChange[]; blobKeys: string[] };

// --- flow ---

async function discardInTransaction(discard: Discard, issues: IssueStore): Promise<Discarded | Refusal> {
  const state = await issues.getIssue(discard.issue);
  if (state === null) return issueNotFound();
  const deleting = beginDeletion(state, discard.actor, discard.at);
  if (isRefusal(deleting)) return deleting;
  const fingerprints = await issues.fingerprintsOf(discard.issue);
  const events = await issues.eventsOf(discard.issue);
  await issues.putTombstone({ issueId: discard.issue, fingerprints, at: discard.at, actor: discard.actor });
  await issues.appendHistory(deleting.changes);
  await issues.removeIssue(discard.issue);
  return {
    changes: [...deleting.changes],
    blobKeys: events.map((event) => eventBlobKey({ projectId: discard.projectId, eventId: event.summary.eventId })),
  };
}

async function deleteBlobs(keys: readonly string[], blobs: BlobStore): Promise<void> {
  for (const key of keys) await blobs.delete(key);
}

// --- exports ---

export async function discardIssue(issue: IssueId, actor: Member, deps: DiscardIssueDeps): Promise<IssueChange[] | Refusal> {
  const discard = { projectId: deps.projectId, issue, actor, at: deps.clock.now() };
  const discarded = await deps.issues.transact(() => discardInTransaction(discard, deps.issues));
  if (isRefusal(discarded)) return discarded;
  await deleteBlobs(discarded.blobKeys, deps.blobs);
  return discarded.changes;
}
