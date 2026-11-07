/**
 * recordTrackerEvent -- the ProjectDO step that applies one Tracker Event to
 * an Issue and its External Link (design Code and GitHub, Two-way state;
 * State Machine: External Link). No design row of its own: applyTrackerEvent
 * reaches it through ProjectClient.
 *
 * In one IssueStore transaction: an event that is the echo of a change
 * Nightwatch made, or that the App itself made, asks for no Issue command;
 * any other asks for the one `issueCommandFor` names, applied with the
 * `tracker` actor so it is never pushed back. A command the Issue's state
 * does not allow changes nothing. The External Link always takes the
 * event's resulting state, or breaks when its Repository was removed. The
 * Issue Changes are enqueued once the transaction has settled.
 * Ports: IssueStore, EffectQueue.
 */

import type { IssueId } from '../../domain/ids.js';
import { archive, resolve, unarchive, unresolve } from '../../domain/issue/commands.js';
import { issueNotFound, unchanged, type IssueChange, type IssueState, type IssueTransition } from '../../domain/issue/state.js';
import { isRefusal, type Refusal } from '../../domain/refusal.js';
import { isEcho, issueCommandFor, linkAfter, type IssueCommand, type TrackerEvent } from '../../domain/tracker/tracker-event.js';
import type { EffectQueue } from '../../ports/effect-queue.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type RecordTrackerEventDeps = { issues: IssueStore; effects: EffectQueue };

/** What the step is told: the Tracker Event, the App's own login, and when it is applied. */
export type TrackedEvent = { readonly event: TrackerEvent; readonly appActor: string; readonly at: number };

// --- helpers ---

function commandResult(state: IssueState, command: IssueCommand, at: number): IssueTransition | Refusal {
  switch (command) {
    case 'resolve':
      return resolve(state, { kind: 'plain' }, 'tracker', at);
    case 'archiveForever':
      return archive(state, { substatus: 'forever', spam: false }, 'tracker', at);
    case 'unresolve':
      return state.status === 'archived' ? unarchive(state, 'tracker', at) : unresolve(state, 'tracker', at);
    default:
      return unchanged(state);
  }
}

function transitionFor(state: IssueState, command: IssueCommand, at: number): IssueTransition {
  const result = commandResult(state, command, at);
  return isRefusal(result) ? unchanged(state) : result;
}

// --- flow ---

async function recordInTransaction(issueId: IssueId, tracked: TrackedEvent, issues: IssueStore): Promise<IssueChange[] | Refusal> {
  const externalLink = await issues.externalLinkOf(issueId);
  if (externalLink === null) return [];
  const state = await issues.getIssue(issueId);
  if (state === null) return issueNotFound();
  const command = isEcho(tracked.event, externalLink, tracked.appActor) ? 'none' : issueCommandFor(tracked.event, externalLink);
  const transition = transitionFor(state, command, tracked.at);
  await issues.putExternalLink(linkAfter(tracked.event, externalLink));
  if (transition.changes.length === 0) return [];
  await issues.putIssue(transition.state);
  await issues.appendHistory(transition.changes);
  return [...transition.changes];
}

// --- exports ---

export async function recordTrackerEvent(
  issue: IssueId,
  tracked: TrackedEvent,
  deps: RecordTrackerEventDeps,
): Promise<IssueChange[] | Refusal> {
  const changes = await deps.issues.transact(() => recordInTransaction(issue, tracked, deps.issues));
  if (!isRefusal(changes) && changes.length > 0) await deps.effects.enqueue(changes);
  return changes;
}
