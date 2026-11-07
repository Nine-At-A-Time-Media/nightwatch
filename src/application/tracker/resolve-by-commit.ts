/**
 * resolveByCommit -- the ProjectDO step that resolves the Issue a Commit
 * says it fixes (design Code and GitHub, Resolve by reference; Behaviors:
 * Resolve by commit, the resolving part). No design row of its own:
 * applyCommits reaches it through ProjectClient. In one IssueStore
 * transaction the Issue the Short Id counter names is resolved with a
 * pending commit Resolution by the `commit` actor; an Issue the command does
 * not allow, such as one already resolved, is refused. The Issue Changes are
 * enqueued once the transaction has settled. Ports: IssueStore, EffectQueue.
 */

import { resolve } from '../../domain/issue/commands.js';
import { issueNotFound, type IssueChange } from '../../domain/issue/state.js';
import { isRefusal, type Refusal } from '../../domain/refusal.js';
import type { EffectQueue } from '../../ports/effect-queue.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type ResolveByCommitDeps = { issues: IssueStore; effects: EffectQueue };

/** The Short Id counter a Commit names, the Commit's key, and when it was applied. */
export type CommitFix = { readonly shortId: number; readonly commit: string; readonly at: number };

// --- flow ---

async function resolveInTransaction(fix: CommitFix, issues: IssueStore): Promise<IssueChange[] | Refusal> {
  const issueId = await issues.issueOfShortId(fix.shortId);
  const state = issueId === null ? null : await issues.getIssue(issueId);
  if (state === null) return issueNotFound();
  const resolved = resolve(state, { kind: 'in_commit', commit: fix.commit, release: null }, 'commit', fix.at);
  if (isRefusal(resolved)) return resolved;
  await issues.putIssue(resolved.state);
  await issues.appendHistory(resolved.changes);
  return [...resolved.changes];
}

// --- exports ---

export async function resolveByCommit(fix: CommitFix, deps: ResolveByCommitDeps): Promise<IssueChange[] | Refusal> {
  const changes = await deps.issues.transact(() => resolveInTransaction(fix, deps.issues));
  if (!isRefusal(changes)) await deps.effects.enqueue(changes);
  return changes;
}
