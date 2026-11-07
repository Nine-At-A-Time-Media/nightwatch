/**
 * mergeIssues -- a Member merges source Issues into a target (design
 * Behaviors: Merge; State Machine: Issue, merge as a source). In one
 * IssueStore transaction every source moves to Merging, hands its
 * Fingerprints and Events (and whatever else the store keeps for it) to the
 * target, and is removed; the target is recounted over all it now holds.
 * Nothing is written unless every Issue named can take part. Events stay at
 * their BlobStore keys, which name the Event and not its Issue, so no blob
 * moves. The Issue Changes are enqueued once the transaction has settled.
 * Ports: IssueStore, BlobStore, EffectQueue, Clock.
 */

import type { IssueId } from '../../domain/ids.js';
import { absorbMerge, beginMerges, mergeRefusal } from '../../domain/issue/regroup.js';
import { goneRefusal, issueNotFound, type IssueChange, type IssueState, type Member } from '../../domain/issue/state.js';
import { isRefusal, type Refusal } from '../../domain/refusal.js';
import type { BlobStore } from '../../ports/blob-store.js';
import type { Clock } from '../../ports/clock.js';
import type { EffectQueue } from '../../ports/effect-queue.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type MergeIssuesDeps = { issues: IssueStore; blobs: BlobStore; effects: EffectQueue; clock: Clock };

type Merge = { target: IssueId; sources: readonly IssueId[]; actor: Member; at: number };

// --- flow ---

async function loadAll(ids: readonly IssueId[], issues: IssueStore): Promise<IssueState[] | Refusal> {
  const states: IssueState[] = [];
  for (const id of ids) {
    const state = await issues.getIssue(id);
    if (state === null) return issueNotFound();
    states.push(state);
  }
  return states;
}

async function moveSources(merge: Merge, issues: IssueStore): Promise<void> {
  for (const source of merge.sources) {
    await issues.reassignIssue({ from: source, to: merge.target });
    await issues.removeIssue(source);
  }
}

async function mergeInTransaction(merge: Merge, issues: IssueStore): Promise<IssueChange[] | Refusal> {
  const refused = mergeRefusal(merge);
  if (refused) return refused;
  const target = await issues.getIssue(merge.target);
  if (target === null) return issueNotFound();
  const gone = goneRefusal(target);
  if (gone) return gone;
  const sources = await loadAll(merge.sources, issues);
  if (isRefusal(sources)) return sources;
  const begun = beginMerges(sources, merge.actor, merge.at);
  if (isRefusal(begun)) return begun;
  await moveSources(merge, issues);
  const events = await issues.eventsOf(merge.target);
  const absorbed = absorbMerge({ ...merge, target, events: events.map((event) => event.summary) });
  if (isRefusal(absorbed)) return absorbed;
  const changes = [...begun.flatMap((transition) => transition.changes), ...absorbed.changes];
  await issues.putIssue(absorbed.state);
  await issues.appendHistory(changes);
  return changes;
}

// --- exports ---

export async function mergeIssues(
  target: IssueId,
  sources: IssueId[],
  actor: Member,
  deps: MergeIssuesDeps,
): Promise<IssueChange[] | Refusal> {
  const merge = { target, sources, actor, at: deps.clock.now() };
  const changes = await deps.issues.transact(() => mergeInTransaction(merge, deps.issues));
  if (!isRefusal(changes)) await deps.effects.enqueue(changes);
  return changes;
}
