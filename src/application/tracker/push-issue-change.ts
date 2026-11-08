/**
 * pushIssueChange -- the github runtime's pass over one Issue Change: a
 * change made in Nightwatch closes or reopens the linked tracker issue
 * (design Behaviors: Nightwatch resolve closes GitHub; GitHub refuses a
 * close; Contact never leaves; Code and GitHub, Two-way state).
 *
 * A change that came from the tracker, or one that maps to no tracker write,
 * sends nothing. A Broken link sends nothing. Before writing, the External
 * Link records the state it expects back, so the tracker's echo is
 * recognised. A refused write never undoes the Nightwatch change: it counts
 * toward the link becoming Broken, and once Broken nothing is retried. A
 * Repository no longer connected breaks the link without a call. Close and
 * reopen carry no text, so no reporter address can travel with them.
 *
 * A `comment` change for a reporter's reply posts that reply to the linked
 * tracker issue (design Code and GitHub, Comments; Behaviors: Reporter reply
 * reaches team), with a body from the outbound reply template, which drops
 * the Reporter's address wherever the reply repeats it. A Member's Comment
 * is never posted. A refused post counts toward Broken like any other write.
 * Ports: Tracker, ProjectClient, ControlStore. The Project is named beside
 * the change, which does not carry it.
 */

import type { ProjectId } from '../../domain/ids.js';
import type { IssueChange } from '../../domain/issue/state.js';
import { isRefusal, refusal, type Refusal } from '../../domain/refusal.js';
import type { ReporterComment } from '../../domain/report/thread.js';
import {
  commentPosted,
  expectPushed,
  markBroken,
  pushRefused,
  pushSucceeded,
  type ExternalLink,
  type TrackerState,
} from '../../domain/tracker/external-link.js';
import { expectedStateAfter, outboundChangeFor, outboundReplyBody, type OutboundChange } from '../../domain/tracker/outbound.js';
import type { TrackerSettings } from '../../domain/tracker/settings.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { ProjectClient } from '../../ports/project-client.js';
import type { Tracker } from '../../ports/tracker.js';

export type PushIssueChangeDeps = { tracker: Tracker; projects: ProjectClient; control: ControlStore; settings: TrackerSettings };

// --- flow: the tracker write ---

async function write(externalLink: ExternalLink, outbound: OutboundChange, tracker: Tracker): Promise<TrackerState | Refusal> {
  const issue = { repository: externalLink.repository, number: externalLink.number };
  if (outbound.kind === 'close') return tracker.closeIssue({ ...issue, reason: outbound.reason });
  return tracker.reopenIssue(issue);
}

async function isConnected(projectId: ProjectId, externalLink: ExternalLink, control: ControlStore): Promise<boolean> {
  const organizationId = await control.organizationOf(projectId);
  return organizationId !== null && control.isRepositoryConnected({ organizationId, repository: externalLink.repository });
}

async function push(
  scope: { projectId: ProjectId; externalLink: ExternalLink; outbound: OutboundChange; expected: TrackerState },
  deps: PushIssueChangeDeps,
): Promise<ExternalLink> {
  const { projectId, externalLink, outbound, expected } = scope;
  if (!(await isConnected(projectId, externalLink, deps.control))) return markBroken(externalLink);
  const pending = expectPushed(externalLink, expected);
  await deps.projects.recordExternalLink(projectId, pending);
  const written = await write(pending, outbound, deps.tracker);
  return isRefusal(written) ? pushRefused(pending, { maxRefusals: deps.settings.maxRefusals }) : pushSucceeded(pending);
}

// --- flow: a reporter's reply ---

async function replyOf(scope: { projectId: ProjectId; change: IssueChange }, projects: ProjectClient): Promise<ReporterComment | null> {
  const { projectId, change } = scope;
  if (change.kind !== 'comment' || change.actor !== 'reporter') return null;
  const comments = await projects.commentsOn(projectId, change.issueId);
  return comments.find((comment): comment is ReporterComment => comment.id === change.to && 'report' in comment.author) ?? null;
}

async function postReply(
  scope: { projectId: ProjectId; externalLink: ExternalLink; reply: ReporterComment },
  deps: PushIssueChangeDeps,
): Promise<ExternalLink> {
  const { projectId, externalLink, reply } = scope;
  if (!(await isConnected(projectId, externalLink, deps.control))) return markBroken(externalLink);
  const report = await deps.projects.getReport(projectId, reply.author.report);
  const body = outboundReplyBody({ text: reply.text, reporterAddress: report?.reporter.email ?? '' });
  const posted = await deps.tracker.postComment({ repository: externalLink.repository, number: externalLink.number, body });
  return isRefusal(posted) ? pushRefused(externalLink, { maxRefusals: deps.settings.maxRefusals }) : commentPosted(externalLink);
}

async function pushReply(
  scope: { projectId: ProjectId; externalLink: ExternalLink; reply: ReporterComment },
  deps: PushIssueChangeDeps,
): Promise<ExternalLink> {
  if (scope.externalLink.state === 'broken') return scope.externalLink;
  const after = await postReply(scope, deps);
  await deps.projects.recordExternalLink(scope.projectId, after);
  return after;
}

// --- exports ---

export async function pushIssueChange(project: ProjectId, change: IssueChange, deps: PushIssueChangeDeps): Promise<ExternalLink | Refusal> {
  const externalLink = await deps.projects.externalLinkOf(project, change.issueId);
  if (externalLink === null) return refusal('not_linked');
  const reply = await replyOf({ projectId: project, change }, deps.projects);
  if (reply !== null) return pushReply({ projectId: project, externalLink, reply }, deps);
  const outbound = outboundChangeFor(change);
  const expected = expectedStateAfter(outbound);
  if (externalLink.state === 'broken' || expected === null) return externalLink;
  const after = await push({ projectId: project, externalLink, outbound, expected }, deps);
  await deps.projects.recordExternalLink(project, after);
  return after;
}
