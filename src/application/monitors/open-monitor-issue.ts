/**
 * openMonitorIssue -- the ProjectDO step that opens a monitor issue (design
 * Releases and monitors, Monitor issues). No design row of its own:
 * advanceMonitor reaches it through ProjectClient. In one IssueStore
 * transaction it opens the Issue, holding no Fingerprint, and gives it a
 * Short Id; an Issue already open under the id is left as it is, so a
 * repeated step opens nothing twice. The Issue Changes are enqueued once
 * the transaction has settled. Ports: IssueStore, EffectQueue.
 */

import type { IssueId } from '../../domain/ids.js';
import type { IssueChange } from '../../domain/issue/state.js';
import { createMonitorIssue } from '../../domain/monitor/monitor-issue.js';
import type { EffectQueue } from '../../ports/effect-queue.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type OpenMonitorIssueDeps = { issues: IssueStore; effects: EffectQueue };

// --- flow ---

async function openInTransaction(opening: { issueId: IssueId; at: number }, issues: IssueStore): Promise<IssueChange[]> {
  if ((await issues.getIssue(opening.issueId)) !== null) return [];
  const opened = createMonitorIssue(opening);
  await issues.assignShortId(opening.issueId);
  await issues.putIssue(opened.state);
  await issues.appendHistory(opened.changes);
  return [...opened.changes];
}

// --- exports ---

export async function openMonitorIssue(opening: { issueId: IssueId; at: number }, deps: OpenMonitorIssueDeps): Promise<IssueChange[]> {
  const changes = await deps.issues.transact(() => openInTransaction(opening, deps.issues));
  if (changes.length > 0) await deps.effects.enqueue(changes);
  return changes;
}
