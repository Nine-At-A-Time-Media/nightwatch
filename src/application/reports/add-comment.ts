/**
 * addComment -- a Member comments on an Issue (design Behaviors: Shared
 * reply reaches reporter; Private comment stays private; Reports, Thread).
 * In one IssueStore transaction the Comment is saved on the Issue and a
 * `comment` change recorded in its History, and the Member follows the Issue
 * from then on (design Alerts and notifications, Subscriptions: a Member
 * follows the Issues they commented on); the change is enqueued once the
 * transaction has settled, and notifyReporters decides from it whether any
 * Reporter is told: only a shared Comment enters a Thread. Ports:
 * IssueStore, EffectQueue, Clock, Ids (the Comment's id).
 */

import { isParticipating, type Participation } from '../../domain/alerts/notification-settings.js';
import type { IssueId } from '../../domain/ids.js';
import type { IssueChange, Member } from '../../domain/issue/state.js';
import { commentRecorded, type MemberComment } from '../../domain/report/thread.js';
import type { Clock } from '../../ports/clock.js';
import type { EffectQueue } from '../../ports/effect-queue.js';
import type { Ids } from '../../ports/ids.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type AddCommentDeps = { issues: IssueStore; effects: EffectQueue; clock: Clock; ids: Ids };

/** What a Member writes: the text, and whether it is shared with the Reporters. */
export type CommentDraft = Pick<MemberComment, 'text' | 'shared'>;

// --- flow ---

async function follow(issueId: IssueId, participation: Participation, issues: IssueStore): Promise<void> {
  if (!isParticipating(await issues.participationsOf(issueId), participation)) await issues.addParticipation(issueId, participation);
}

async function saveInTransaction(issueId: IssueId, comment: MemberComment, issues: IssueStore): Promise<IssueChange[]> {
  const state = await issues.getIssue(issueId);
  if (state === null) return [];
  const changes = [commentRecorded(state, comment, comment.author)];
  await issues.appendComment(issueId, comment);
  await issues.appendHistory(changes);
  await follow(issueId, { member: comment.author.member, reason: 'commented' }, issues);
  return changes;
}

// --- exports ---

export async function addComment(issue: IssueId, comment: CommentDraft, actor: Member, deps: AddCommentDeps): Promise<IssueChange[]> {
  const saved: MemberComment = { id: deps.ids.newId(), author: actor, shared: comment.shared, text: comment.text, at: deps.clock.now() };
  const changes = await deps.issues.transact(() => saveInTransaction(issue, saved, deps.issues));
  if (changes.length > 0) await deps.effects.enqueue(changes);
  return changes;
}
