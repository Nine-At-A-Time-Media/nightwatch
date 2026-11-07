/**
 * applyTrackerEvent -- the github runtime applies one Tracker Event, already
 * proven to come from the tracker and parsed by the github adapter (design
 * Behaviors: GitHub close resolves; GitHub not-planned closes report; GitHub
 * reopen; No echo; Shared GitHub comment; Uninstalled app).
 *
 * The link index finds the Issue a tracker issue is linked to; an event about
 * an issue Nightwatch never linked changes nothing. A state change goes to
 * the Project, which applies it unless it is an echo. A comment enters the
 * Threads only when it carries the share marker and its author maps to a
 * Member of the Organization (design Q3, resolved here as any Member of the
 * Organization); an unmapped author's marked comment is refused. A removed
 * installation or Repository disconnects the Repositories and breaks every
 * External Link in them, so nothing is retried against them.
 * Ports: ControlStore, ProjectClient, Clock.
 */

import type { IssueChange } from '../../domain/issue/state.js';
import { refusal, type Refusal } from '../../domain/refusal.js';
import type { TrackerSettings } from '../../domain/tracker/settings.js';
import { sharedCommentText } from '../../domain/tracker/share-marker.js';
import { isEcho, type TrackerEvent } from '../../domain/tracker/tracker-event.js';
import type { Clock } from '../../ports/clock.js';
import type { ControlStore, LinkEntry } from '../../ports/control-store.js';
import type { ProjectClient } from '../../ports/project-client.js';

export type ApplyTrackerEventDeps = { control: ControlStore; projects: ProjectClient; clock: Clock; settings: TrackerSettings };

type CommentEvent = Extract<TrackerEvent, { kind: 'comment_created' }>;
type RemovalEvent = Extract<TrackerEvent, { kind: 'installation_removed' | 'repository_removed' }>;

// --- predicates ---

function isRemoval(event: TrackerEvent): event is RemovalEvent {
  return event.kind === 'installation_removed' || event.kind === 'repository_removed';
}

// --- helpers ---

function removedRepositories(event: RemovalEvent): readonly string[] {
  return event.kind === 'installation_removed' ? event.repositories : [event.repository];
}

// --- flow: removals ---

async function breakLinks(event: RemovalEvent, deps: ApplyTrackerEventDeps): Promise<IssueChange[]> {
  const repositories = removedRepositories(event);
  const entries = await deps.control.linkEntriesIn(repositories);
  await deps.control.disconnectRepositories(repositories);
  const at = deps.clock.now();
  for (const entry of entries) {
    await deps.projects.recordTrackerEvent(entry.projectId, { issueId: entry.issueId, event, appActor: deps.settings.appActor, at });
  }
  return [];
}

// --- flow: comments ---

async function shareComment(event: CommentEvent, entry: LinkEntry, deps: ApplyTrackerEventDeps): Promise<IssueChange[] | Refusal> {
  const externalLink = await deps.projects.externalLinkOf(entry.projectId, entry.issueId);
  if (externalLink === null || externalLink.state === 'broken' || isEcho(event, externalLink, deps.settings.appActor)) return [];
  const text = sharedCommentText(event.body, deps.settings.shareMarker);
  if (text === null) return [];
  const organizationId = await deps.control.organizationOf(entry.projectId);
  const author = organizationId === null ? null : await deps.control.memberOfTrackerAccount({ organizationId, login: event.author.login });
  if (author === null) return refusal('not_a_member');
  return deps.projects.addTrackerComment(entry.projectId, { issueId: entry.issueId, author, text, at: deps.clock.now() });
}

// --- exports ---

export async function applyTrackerEvent(event: TrackerEvent, deps: ApplyTrackerEventDeps): Promise<IssueChange[] | Refusal> {
  if (isRemoval(event)) return breakLinks(event, deps);
  const entry = await deps.control.findLinkEntry({ repository: event.repository, number: event.number });
  if (entry === null) return [];
  if (event.kind === 'comment_created') return shareComment(event, entry, deps);
  return deps.projects.recordTrackerEvent(entry.projectId, {
    issueId: entry.issueId,
    event,
    appActor: deps.settings.appActor,
    at: deps.clock.now(),
  });
}
