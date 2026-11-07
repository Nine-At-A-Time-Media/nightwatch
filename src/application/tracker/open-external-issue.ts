/**
 * openExternalIssue -- a Member opens a tracker issue from a Nightwatch Issue
 * (design Behaviors: Open GitHub issue; Code and GitHub, Open). The actor
 * must be a Member of the Project's Organization and the Repository
 * connected to it. The tracker issue's body comes from the outbound
 * template, which has no field for a reporter address or an Attachment; a
 * Report issue with no Event gets a neutral title, never the Report message.
 * Once the tracker has opened the issue, the External Link is recorded on
 * the Issue and indexed by its tracker issue, so Tracker Events find it.
 * An Issue whose link is Broken is relinked instead (design Behaviors: Broken
 * link relinked): once its Repository is connected again, the same tracker
 * issue is read back and the link is Linked with nothing pending.
 * Ports: Tracker, ProjectClient, ControlStore. The Project is named beside
 * the Issue, which does not carry it.
 */

import type { EventSummary } from '../../domain/event/event-summary.js';
import type { IssueId, ProjectId } from '../../domain/ids.js';
import { issueNotFound, type IssueState, type Member } from '../../domain/issue/state.js';
import { refusal, isRefusal, type Refusal } from '../../domain/refusal.js';
import { link, relink, type ExternalLink, type Repository } from '../../domain/tracker/external-link.js';
import { outboundIssueBody, type OutboundIssueFacts } from '../../domain/tracker/outbound.js';
import type { TrackerSettings } from '../../domain/tracker/settings.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { ProjectClient } from '../../ports/project-client.js';
import type { Tracker } from '../../ports/tracker.js';

export type OpenExternalIssueDeps = { tracker: Tracker; projects: ProjectClient; control: ControlStore; settings: TrackerSettings };

/** The title of a Report issue that holds no Event yet. */
const REPORT_ISSUE_TITLE = 'User report';

// --- helpers ---

function evidenceUrl(settings: TrackerSettings, scope: { projectId: ProjectId; issueId: IssueId }): string {
  return `${settings.consoleBaseUrl}/projects/${encodeURIComponent(scope.projectId)}/issues/${encodeURIComponent(scope.issueId)}`;
}

function factsOf(issue: IssueState, latest: EventSummary | null, extra: { evidenceUrl: string; reportCount: number }): OutboundIssueFacts {
  return {
    title: latest?.title ?? REPORT_ISSUE_TITLE,
    culprit: latest?.culprit ?? '',
    evidenceUrl: extra.evidenceUrl,
    counts: { events: issue.count, users: issue.userCount },
    firstSeen: issue.firstSeen,
    lastSeen: issue.lastSeen,
    reportCount: extra.reportCount,
  };
}

// --- flow: checks ---

async function permissionRefusal(
  scope: { projectId: ProjectId; repository: Repository; actor: Member },
  control: ControlStore,
): Promise<Refusal | null> {
  const organizationId = await control.organizationOf(scope.projectId);
  const membership = await control.membershipOf(scope.actor);
  if (organizationId === null || membership?.organizationId !== organizationId) return refusal('not_a_member');
  const connected = await control.isRepositoryConnected({ organizationId, repository: scope.repository });
  return connected ? null : refusal('repository_not_connected');
}

// --- flow: opening ---

async function openOnTracker(
  scope: { projectId: ProjectId; issue: IssueState; repository: Repository },
  deps: OpenExternalIssueDeps,
): Promise<ExternalLink | Refusal> {
  const { projectId, issue, repository } = scope;
  const latest = await deps.projects.latestEventOf(projectId, issue.issueId);
  const reports = await deps.projects.reportsOn(projectId, issue.issueId);
  const facts = factsOf(issue, latest, {
    evidenceUrl: evidenceUrl(deps.settings, { projectId, issueId: issue.issueId }),
    reportCount: reports.length,
  });
  const opened = await deps.tracker.openIssue({
    repository,
    title: facts.title,
    body: outboundIssueBody(facts),
    labels: deps.settings.labels,
  });
  if (isRefusal(opened)) return opened;
  return link({ issueId: issue.issueId, repository, number: opened.number, lastKnown: { state: 'open' } });
}

/** Broken to Linked: the tracker issue's current state becomes the last known one; nothing is opened. */
async function relinkOnTracker(broken: ExternalLink, repository: Repository, tracker: Tracker): Promise<ExternalLink | Refusal> {
  if (broken.repository !== repository) return refusal('transition_not_allowed');
  const current = await tracker.getIssue({ repository, number: broken.number });
  return isRefusal(current) ? current : relink(broken, { lastKnown: current });
}

async function recordLink(projectId: ProjectId, externalLink: ExternalLink, deps: OpenExternalIssueDeps): Promise<ExternalLink> {
  await deps.projects.recordExternalLink(projectId, externalLink);
  await deps.control.putLinkEntry({
    repository: externalLink.repository,
    number: externalLink.number,
    projectId,
    issueId: externalLink.issueId,
  });
  return externalLink;
}

// --- exports ---

export async function openExternalIssue(
  project: ProjectId,
  issue: IssueId,
  repository: Repository,
  actor: Member,
  deps: OpenExternalIssueDeps,
): Promise<ExternalLink | Refusal> {
  const refused = await permissionRefusal({ projectId: project, repository, actor }, deps.control);
  if (refused) return refused;
  const state = await deps.projects.getIssue(project, issue);
  if (state === null) return issueNotFound();
  const existing = await deps.projects.externalLinkOf(project, issue);
  if (existing?.state === 'linked') return refusal('already_linked');
  const linked = existing
    ? await relinkOnTracker(existing, repository, deps.tracker)
    : await openOnTracker({ projectId: project, issue: state, repository }, deps);
  return isRefusal(linked) ? linked : recordLink(project, linked, deps);
}
