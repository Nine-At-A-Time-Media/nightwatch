/**
 * recordReleaseSeen -- a Release seen for the first time in this Project
 * (design Behaviors: Resolve in next release). In one IssueStore transaction
 * it records the Release's first sight, which Release ordering reads, and
 * names it in every pending next-release Resolution. A Release already seen
 * changes nothing, so the call is safe to repeat for every Event. The Issue
 * Changes are enqueued once the transaction has settled. Ports: IssueStore,
 * EffectQueue, Clock.
 */

import { recordReleaseSeen as nameReleaseSeen } from '../../domain/issue/releases.js';
import type { IssueChange } from '../../domain/issue/state.js';
import type { Release } from '../../domain/release/ordering.js';
import type { Clock } from '../../ports/clock.js';
import type { EffectQueue } from '../../ports/effect-queue.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type RecordReleaseSeenDeps = { issues: IssueStore; effects: EffectQueue; clock: Clock };

// --- flow ---

async function nameInIssues(release: Release, now: number, issues: IssueStore): Promise<IssueChange[]> {
  const changes: IssueChange[] = [];
  for (const state of await issues.listIssues()) {
    const named = nameReleaseSeen(state, release, now);
    if (named.changes.length === 0) continue;
    await issues.putIssue(named.state);
    await issues.appendHistory(named.changes);
    changes.push(...named.changes);
  }
  return changes;
}

async function recordInTransaction(release: Release, now: number, issues: IssueStore): Promise<IssueChange[]> {
  const firstSeen = await issues.releaseFirstSeen();
  if (firstSeen.has(release)) return [];
  await issues.recordReleaseFirstSeen(release, now);
  return nameInIssues(release, now, issues);
}

// --- exports ---

export async function recordReleaseSeen(release: Release, deps: RecordReleaseSeenDeps): Promise<IssueChange[]> {
  const now = deps.clock.now();
  const changes = await deps.issues.transact(() => recordInTransaction(release, now, deps.issues));
  if (changes.length > 0) await deps.effects.enqueue(changes);
  return changes;
}
