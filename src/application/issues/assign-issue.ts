/**
 * assignIssue -- an Issue is given its Assignee (design Issues, Assignment;
 * Alerts and notifications, Subscriptions). No design row of its own: a
 * Member's assign action is one of the triage actions the architecture lists
 * under triageIssue, and a Project that auto-assigns reaches it from
 * suggestOwners with Nightwatch itself as the actor.
 *
 * In one IssueStore transaction the Assignee is saved, the `assignee` change
 * (and, for a Member's action, leaving For Review) is recorded in History,
 * and an assigned Member follows the Issue from then on. The changes are
 * enqueued once the transaction has settled. Ports: IssueStore, EffectQueue,
 * Clock.
 */

import type { Assignee } from '../../domain/alerts/issue-alert-rule.js';
import { isParticipating, type Participation } from '../../domain/alerts/notification-settings.js';
import type { IssueId } from '../../domain/ids.js';
import { assign } from '../../domain/issue/assignee.js';
import { issueNotFound, type IssueChange, type Member } from '../../domain/issue/state.js';
import { isRefusal, type Refusal } from '../../domain/refusal.js';
import type { Clock } from '../../ports/clock.js';
import type { EffectQueue } from '../../ports/effect-queue.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type AssignIssueDeps = { issues: IssueStore; effects: EffectQueue; clock: Clock };

/** Who assigns: a Member, or Nightwatch itself when the Project auto-assigns. */
export type Assigner = Member | 'system';

// --- flow ---

async function follow(issueId: IssueId, participation: Participation, issues: IssueStore): Promise<void> {
  if (!isParticipating(await issues.participationsOf(issueId), participation)) await issues.addParticipation(issueId, participation);
}

async function assignInTransaction(
  scope: { issueId: IssueId; assignee: Assignee | null; actor: Assigner; at: number },
  issues: IssueStore,
): Promise<IssueChange[] | Refusal> {
  const { issueId, assignee, actor, at } = scope;
  const state = await issues.getIssue(issueId);
  if (state === null) return issueNotFound();
  const assigned = assign(state, { from: await issues.assigneeOf(issueId), to: assignee, actor, at });
  if (isRefusal(assigned)) return assigned;
  await issues.putIssue(assigned.state);
  await issues.setAssignee(issueId, assignee);
  await issues.appendHistory(assigned.changes);
  if (assignee !== null && 'member' in assignee) await follow(issueId, { member: assignee.member, reason: 'assigned' }, issues);
  return [...assigned.changes];
}

// --- exports ---

export async function assignIssue(
  issue: IssueId,
  assignee: Assignee | null,
  actor: Assigner,
  deps: AssignIssueDeps,
): Promise<IssueChange[] | Refusal> {
  const scope = { issueId: issue, assignee, actor, at: deps.clock.now() };
  const changes = await deps.issues.transact(() => assignInTransaction(scope, deps.issues));
  if (!isRefusal(changes) && changes.length > 0) await deps.effects.enqueue(changes);
  return changes;
}
