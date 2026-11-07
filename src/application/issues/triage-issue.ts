/**
 * triageIssue -- a Member's triage action on one Issue: resolve (plainly, in
 * a release, or in the next release), archive (until escalating, until a
 * condition, or forever), unarchive, unresolve, set Priority, or mark
 * reviewed (design Issues, Lifecycle, Priority, Inbox; State Machine:
 * Issue, the rows a member triggers). No design row of its own; it sets the
 * Given of the archive and priority rows that assignEvent carries out.
 *
 * In one IssueStore transaction the domain's transition is applied and the
 * next state and its Issue Changes are written together; the changes are
 * enqueued once the transaction has settled. A refused action writes and
 * enqueues nothing. Ports: IssueStore, EffectQueue, Clock.
 */

import type { IssueId } from '../../domain/ids.js';
import { issueNotFound, type IssueChange, type Member } from '../../domain/issue/state.js';
import { triage, type TriageAction } from '../../domain/issue/triage.js';
import { isRefusal, type Refusal } from '../../domain/refusal.js';
import type { Clock } from '../../ports/clock.js';
import type { EffectQueue } from '../../ports/effect-queue.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type TriageIssueDeps = { issues: IssueStore; effects: EffectQueue; clock: Clock };

type Triage = { issue: IssueId; action: TriageAction; actor: Member; at: number };

// --- flow ---

async function triageInTransaction(request: Triage, issues: IssueStore): Promise<IssueChange[] | Refusal> {
  const state = await issues.getIssue(request.issue);
  if (state === null) return issueNotFound();
  const transition = triage(state, request.action, request.actor, request.at);
  if (isRefusal(transition)) return transition;
  await issues.putIssue(transition.state);
  await issues.appendHistory(transition.changes);
  return [...transition.changes];
}

// --- exports ---

export async function triageIssue(
  issue: IssueId,
  action: TriageAction,
  actor: Member,
  deps: TriageIssueDeps,
): Promise<IssueChange[] | Refusal> {
  const request = { issue, action, actor, at: deps.clock.now() };
  const changes = await deps.issues.transact(() => triageInTransaction(request, deps.issues));
  if (!isRefusal(changes) && changes.length > 0) await deps.effects.enqueue(changes);
  return changes;
}
