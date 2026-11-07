/**
 * notifyReporters -- the notifier's pass over one Issue Change (design
 * Behaviors: Status change notifies; Fix ships; Duplicate reports share
 * outcome; Unsubscribe; Regression reopens a Report; State Machine: Report
 * Status). For every Report attached to the changed Issue it derives the
 * Report Status now, compares it with the status the Reporter was last
 * shown, records a Report Status Change when they differ, and sends a
 * notice -- never for spam, never to an unsubscribed Reporter. A `comment`
 * change also sends the shared Member Comment it names. Repeating a change
 * sends nothing new, since the status shown has already moved.
 *
 * Each notice links the Follow-up Page through a newly minted Report
 * Reference, because only hashes of earlier ones are kept. Ports:
 * ProjectClient, ControlStore, Mailer, Ids, Clock. The Project is named
 * beside the change, which does not carry it.
 */

import type { OrganizationId, ProjectId } from '../../domain/ids.js';
import type { IssueChange, IssueState } from '../../domain/issue/state.js';
import { followUpUrl, type ReportSettings } from '../../domain/report/filing.js';
import { commentNotice, statusNotice, type Notice } from '../../domain/report/notice.js';
import { reporterNotificationFor, reporterNotificationForComment, type ReporterNotification } from '../../domain/report/notification.js';
import type { Report } from '../../domain/report/report.js';
import { reportStatusOf, type ReportStatusFacts } from '../../domain/report/status.js';
import { lastShownStatus, triageOf, type Comment } from '../../domain/report/thread.js';
import type { Clock } from '../../ports/clock.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { Ids } from '../../ports/ids.js';
import type { Mailer } from '../../ports/mailer.js';
import type { ProjectClient } from '../../ports/project-client.js';
import { mintReference } from './mint-reference.js';

export type NotifyReportersDeps = {
  projects: ProjectClient;
  control: ControlStore;
  mailer: Mailer;
  ids: Ids;
  clock: Clock;
  settings: ReportSettings;
};

type IssueFacts = { projectId: ProjectId; organizationId: OrganizationId; issue: IssueState; comments: readonly Comment[]; facts: Omit<ReportStatusFacts, 'lastShown'> };

// --- helpers ---

function noticeOf(notification: ReporterNotification, comments: readonly Comment[], link: string): Notice {
  if ('status' in notification.about) return statusNotice({ status: notification.about.status, link });
  const commentId = notification.about.comment;
  return commentNotice({ text: comments.find((comment) => comment.id === commentId)?.text ?? '', link });
}

// --- flow: sending ---

async function send(
  notification: ReporterNotification,
  context: { report: Report; comments: readonly Comment[]; organizationId: OrganizationId },
  deps: NotifyReportersDeps,
): Promise<boolean> {
  const { report } = context;
  const minted = await mintReference({ organizationId: context.organizationId, projectId: report.projectId, reportId: report.id }, deps);
  if (!minted.stored.ok) return false;
  const notice = noticeOf(notification, context.comments, followUpUrl(deps.settings.followUpBaseUrl, minted.reference));
  const sent = await deps.mailer.send({ to: notification.to, subject: notice.subject, text: notice.text, headers: {} });
  return sent.ok;
}

// --- flow: one Report ---

async function statusNotification(report: Report, issue: IssueFacts, deps: NotifyReportersDeps): Promise<ReporterNotification | null> {
  const before = lastShownStatus(await deps.projects.statusChangesOf(issue.projectId, report.id));
  const after = reportStatusOf(issue.issue, null, { ...issue.facts, lastShown: before });
  if (after !== before && !report.spam) {
    await deps.projects.recordShownStatus(issue.projectId, report.id, { status: after, at: deps.clock.now() });
  }
  return reporterNotificationFor(before, after, report);
}

function commentNotification(change: IssueChange, report: Report, comments: readonly Comment[]): ReporterNotification | null {
  if (change.kind !== 'comment') return null;
  const comment = comments.find((entry) => entry.id === change.to);
  return comment ? reporterNotificationForComment(comment, report) : null;
}

async function notifyOne(change: IssueChange, stored: Report, issue: IssueFacts, deps: NotifyReportersDeps): Promise<ReporterNotification[]> {
  const report = { ...stored, unsubscribed: await deps.control.isUnsubscribed(stored.id) };
  const due = [await statusNotification(report, issue, deps), commentNotification(change, report, issue.comments)];
  const sent: ReporterNotification[] = [];
  for (const notification of due) {
    if (notification && (await send(notification, { report, comments: issue.comments, organizationId: issue.organizationId }, deps))) sent.push(notification);
  }
  return sent;
}

// --- flow: the Issue ---

async function factsOf(scope: { projectId: ProjectId; organizationId: OrganizationId }, issue: IssueState, projects: ProjectClient): Promise<IssueFacts> {
  const comments = await projects.commentsOn(scope.projectId, issue.issueId);
  const releasesSeen = await projects.releasesSeen(scope.projectId);
  return { ...scope, issue, comments, facts: { triage: triageOf(comments), releasesSeen } };
}

// --- exports ---

export async function notifyReporters(project: ProjectId, change: IssueChange, deps: NotifyReportersDeps): Promise<ReporterNotification[]> {
  const organizationId = await deps.control.organizationOf(project);
  const issue = await deps.projects.getIssue(project, change.issueId);
  if (organizationId === null || issue === null) return [];
  const facts = await factsOf({ projectId: project, organizationId }, issue, deps.projects);
  const sent: ReporterNotification[] = [];
  for (const report of await deps.projects.reportsOn(project, change.issueId)) sent.push(...(await notifyOne(change, report, facts, deps)));
  return sent;
}
