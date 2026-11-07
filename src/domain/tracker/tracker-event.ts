/**
 * Tracker Event -- a change on the GitHub side, in provider-neutral terms,
 * after the github adapter has proven it came from GitHub and parsed it
 * (design Code and GitHub, Two-way state; State Machine: External Link).
 *
 * Decides which Issue command a Tracker Event asks for, whether it is the
 * echo of a change Nightwatch made (no echo), and what it does to the
 * External Link. A Broken link carries nothing from GitHub. A reopen asks
 * for `unresolve`: back to Unresolved, which for an Issue archived forever
 * is its unarchive command.
 */

import {
  isSameTrackerState,
  markBroken,
  observe,
  type CloseReason,
  type ExternalLink,
  type Repository,
  type TrackerState,
} from './external-link.js';

/** The person or app that wrote a GitHub comment; `canWrite` is their write access to the Repository. */
export type CommentAuthor = { readonly login: string; readonly canWrite: boolean };

/** `actor` is the login of whoever made the change on GitHub. */
export type TrackerEvent =
  | {
      readonly kind: 'issue_closed';
      readonly repository: Repository;
      readonly number: number;
      readonly reason: CloseReason;
      readonly actor: string;
    }
  | { readonly kind: 'issue_reopened'; readonly repository: Repository; readonly number: number; readonly actor: string }
  | {
      readonly kind: 'comment_created';
      readonly repository: Repository;
      readonly number: number;
      readonly author: CommentAuthor;
      readonly body: string;
    }
  | { readonly kind: 'installation_removed'; readonly repositories: readonly Repository[] }
  | { readonly kind: 'repository_removed'; readonly repository: Repository };

/** The Issue command a Tracker Event asks for. */
export type IssueCommand = 'resolve' | 'archiveForever' | 'unresolve' | 'none';

// --- predicates ---

/** Whether the event is about the link's GitHub issue, or removes its Repository. */
export function isAboutLink(event: TrackerEvent, externalLink: ExternalLink): boolean {
  switch (event.kind) {
    case 'installation_removed':
      return event.repositories.includes(externalLink.repository);
    case 'repository_removed':
      return event.repository === externalLink.repository;
    default:
      return event.repository === externalLink.repository && event.number === externalLink.number;
  }
}

function isByApp(event: TrackerEvent, appActor: string): boolean {
  switch (event.kind) {
    case 'issue_closed':
    case 'issue_reopened':
      return event.actor === appActor;
    case 'comment_created':
      return event.author.login === appActor;
    default:
      return false;
  }
}

// --- helpers ---

/** The GitHub issue state the event leaves behind; null for events that change no state. */
export function resultingState(event: TrackerEvent): TrackerState | null {
  if (event.kind === 'issue_closed') return { state: 'closed', reason: event.reason };
  if (event.kind === 'issue_reopened') return { state: 'open' };
  return null;
}

// --- exports ---

export function issueCommandFor(event: TrackerEvent, externalLink: ExternalLink): IssueCommand {
  if (externalLink.state === 'broken' || !isAboutLink(event, externalLink)) return 'none';
  if (event.kind === 'issue_closed') return event.reason === 'completed' ? 'resolve' : 'archiveForever';
  if (event.kind === 'issue_reopened') return 'unresolve';
  return 'none';
}

/** No echo: the event's resulting state is the one Nightwatch pushed, or the App itself acted. */
export function isEcho(event: TrackerEvent, externalLink: ExternalLink, appActor: string): boolean {
  if (isByApp(event, appActor)) return true;
  const state = resultingState(event);
  const { expected } = externalLink;
  return state !== null && expected !== null && isSameTrackerState(state, expected);
}

/** The External Link after the event: removals break it, state changes are observed, anything else leaves it. */
export function linkAfter(event: TrackerEvent, externalLink: ExternalLink): ExternalLink {
  if (!isAboutLink(event, externalLink)) return externalLink;
  if (event.kind === 'installation_removed' || event.kind === 'repository_removed') return markBroken(externalLink);
  const state = resultingState(event);
  return state === null ? externalLink : observe(externalLink, state);
}
