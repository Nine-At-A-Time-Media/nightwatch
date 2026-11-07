/**
 * addTrackerComment -- the ProjectDO step that saves a tracker comment
 * marked for the reporter (design Behaviors: Shared GitHub comment; Code
 * and GitHub, Comments). No design row of its own: applyTrackerEvent
 * reaches it through ProjectClient once the comment's author maps to a
 * Member. In one IssueStore transaction the text is saved as a shared
 * Comment by that Member, and a `comment` change with the `tracker` actor
 * recorded, so it is never posted back. The change is enqueued once the
 * transaction has settled; notifyReporters sends it into each Thread.
 * Ports: IssueStore, EffectQueue, Ids (the Comment's id).
 */

import type { IssueId } from '../../domain/ids.js';
import { issueNotFound, type IssueChange, type Member } from '../../domain/issue/state.js';
import { isRefusal, type Refusal } from '../../domain/refusal.js';
import { commentRecorded, type MemberComment } from '../../domain/report/thread.js';
import type { EffectQueue } from '../../ports/effect-queue.js';
import type { Ids } from '../../ports/ids.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type AddTrackerCommentDeps = { issues: IssueStore; effects: EffectQueue; ids: Ids };

/** The shared text, the Member its tracker author maps to, and when it was applied. */
export type TrackerComment = { readonly author: Member; readonly text: string; readonly at: number };

// --- flow ---

async function saveInTransaction(issueId: IssueId, comment: MemberComment, issues: IssueStore): Promise<IssueChange[] | Refusal> {
  const state = await issues.getIssue(issueId);
  if (state === null) return issueNotFound();
  const changes = [commentRecorded(state, comment, 'tracker')];
  await issues.appendComment(issueId, comment);
  await issues.appendHistory(changes);
  return changes;
}

// --- exports ---

export async function addTrackerComment(
  issue: IssueId,
  comment: TrackerComment,
  deps: AddTrackerCommentDeps,
): Promise<IssueChange[] | Refusal> {
  const saved: MemberComment = { id: deps.ids.newId(), author: comment.author, shared: true, text: comment.text, at: comment.at };
  const changes = await deps.issues.transact(() => saveInTransaction(issue, saved, deps.issues));
  if (!isRefusal(changes)) await deps.effects.enqueue(changes);
  return changes;
}
