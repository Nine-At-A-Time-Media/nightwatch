/**
 * recordCommitShipped -- the ProjectDO step that names a Release in every
 * pending Resolution waiting for a Commit that ships in it (design Code and
 * GitHub, Resolve by reference; Behaviors: Resolve by commit, the completing
 * part). No design row of its own: applyCommits reaches it through
 * ProjectClient. In one IssueStore transaction each resolved Issue whose
 * commit Resolution waits for that Commit takes the Release; any other is
 * left alone, so the call is safe to repeat. The Issue Changes are enqueued
 * once the transaction has settled. Ports: IssueStore, EffectQueue.
 */

import { recordCommitShipped as nameCommitRelease } from '../../domain/issue/releases.js';
import type { IssueChange } from '../../domain/issue/state.js';
import type { Release } from '../../domain/release/ordering.js';
import type { EffectQueue } from '../../ports/effect-queue.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type RecordCommitShippedDeps = { issues: IssueStore; effects: EffectQueue };

/** The Commit's key, the Release it ships in, and when that was learned. */
export type CommitShipped = { readonly commit: string; readonly release: Release; readonly at: number };

// --- flow ---

async function nameInTransaction(shipped: CommitShipped, issues: IssueStore): Promise<IssueChange[]> {
  const changes: IssueChange[] = [];
  for (const state of await issues.listIssues()) {
    const named = nameCommitRelease(state, { commit: shipped.commit, release: shipped.release }, shipped.at);
    if (named.changes.length === 0) continue;
    await issues.putIssue(named.state);
    await issues.appendHistory(named.changes);
    changes.push(...named.changes);
  }
  return changes;
}

// --- exports ---

export async function recordCommitShipped(shipped: CommitShipped, deps: RecordCommitShippedDeps): Promise<IssueChange[]> {
  const changes = await deps.issues.transact(() => nameInTransaction(shipped, deps.issues));
  if (changes.length > 0) await deps.effects.enqueue(changes);
  return changes;
}
