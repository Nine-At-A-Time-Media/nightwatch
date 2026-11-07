/**
 * recordReply -- the ProjectDO step that saves a Reporter's reply (design
 * Reports, Thread: a reporter's reply always enters the Thread and is shown
 * to the team). No design row of its own: replyAsReporter reaches it through
 * ProjectClient. In one IssueStore transaction the reply is saved on the
 * Issue its Report is attached to now, and a `comment` change recorded in
 * the Issue's History; the change names the Comment, never the Reporter.
 * Returns the changes for the caller to enqueue. Ports: IssueStore.
 */

import { issueNotFound, type IssueChange } from '../../domain/issue/state.js';
import { refusal, type Refusal } from '../../domain/refusal.js';
import { commentRecorded, type ReporterComment } from '../../domain/report/thread.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type RecordReplyDeps = { issues: IssueStore };

// --- flow ---

async function recordInTransaction(comment: ReporterComment, issues: IssueStore): Promise<IssueChange[] | Refusal> {
  const report = await issues.getReport(comment.author.report);
  if (report === null) return refusal('not-found');
  const state = await issues.getIssue(report.issueId);
  if (state === null) return issueNotFound();
  const changes = [commentRecorded(state, comment, 'reporter')];
  await issues.appendComment(report.issueId, comment);
  await issues.appendHistory(changes);
  return changes;
}

// --- exports ---

export async function recordReply(comment: ReporterComment, deps: RecordReplyDeps): Promise<IssueChange[] | Refusal> {
  return deps.issues.transact(() => recordInTransaction(comment, deps.issues));
}
