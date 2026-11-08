/**
 * resolveMonitorIssue -- the ProjectDO step that resolves a monitor issue
 * when its monitor recovers (design Releases and monitors, Monitor issues).
 * No design row of its own: advanceMonitor reaches it through
 * ProjectClient. In one IssueStore transaction it resolves the Issue
 * plainly; an Issue gone, or one a Member already moved out of Unresolved,
 * changes nothing. The Issue Changes are enqueued once the transaction has
 * settled. Ports: IssueStore, EffectQueue.
 */

import type { IssueId } from '../../domain/ids.js';
import type { IssueChange } from '../../domain/issue/state.js';
import { resolveMonitorIssue as resolveIssue } from '../../domain/monitor/monitor-issue.js';
import type { EffectQueue } from '../../ports/effect-queue.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type ResolveMonitorIssueDeps = { issues: IssueStore; effects: EffectQueue };

// --- flow ---

async function resolveInTransaction(resolving: { issueId: IssueId; at: number }, issues: IssueStore): Promise<IssueChange[]> {
  const state = await issues.getIssue(resolving.issueId);
  if (state === null) return [];
  const resolved = resolveIssue(state, resolving.at);
  if (resolved.changes.length === 0) return [];
  await issues.putIssue(resolved.state);
  await issues.appendHistory(resolved.changes);
  return [...resolved.changes];
}

// --- exports ---

export async function resolveMonitorIssue(
  resolving: { issueId: IssueId; at: number },
  deps: ResolveMonitorIssueDeps,
): Promise<IssueChange[]> {
  const changes = await deps.issues.transact(() => resolveInTransaction(resolving, deps.issues));
  if (changes.length > 0) await deps.effects.enqueue(changes);
  return changes;
}
