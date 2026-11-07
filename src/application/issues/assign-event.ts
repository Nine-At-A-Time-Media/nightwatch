/**
 * assignEvent -- puts one processed Event on its Issue inside ProjectDO
 * (design Behaviors: Processing and grouping; Issues, event-triggered rows).
 * The whole assignment runs in one IssueStore transaction, so concurrent
 * first events of a Fingerprint create one Issue. In order: an Event Id
 * already assigned within the dedup window repeats its earlier target; a
 * Tombstone holding a Fingerprint drops the Event; an Issue holding a
 * Fingerprint takes the Event and applies the transitions it triggers;
 * otherwise a new Issue opens. Ports: IssueStore, Clock, Ids.
 */

import type { EventSummary } from '../../domain/event/event-summary.js';
import type { Fingerprint } from '../../domain/grouping/fingerprint.js';
import type { IssueId } from '../../domain/ids.js';
import { dropped, duplicateOf, joined, targetOf, type Assignment } from '../../domain/issue/assignment.js';
import { applyEvent, createIssue, type EventFacts } from '../../domain/issue/event.js';
import type { IssuePolicies } from '../../domain/issue/policies.js';
import type { IssueState, IssueTransition } from '../../domain/issue/state.js';
import { conditionWindowStarts, hourStart } from '../../domain/issue/tally.js';
import { isRefusal } from '../../domain/refusal.js';
import type { Clock } from '../../ports/clock.js';
import type { Ids } from '../../ports/ids.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type AssignEventDeps = { issues: IssueStore; clock: Clock; ids: Ids; policies: IssuePolicies };

type Placement = { summary: EventSummary; fingerprints: readonly Fingerprint[] };

// --- flow: measuring ---

async function isNewUser(issueId: IssueId, summary: EventSummary, issues: IssueStore): Promise<boolean> {
  if (summary.userKey === null) return false;
  return !(await issues.hasUser({ issueId, userKey: summary.userKey }));
}

async function countSince(issueId: IssueId, since: number | null, issues: IssueStore): Promise<number | null> {
  return since === null ? null : issues.countEvents({ issueId, since });
}

async function usersSince(issueId: IssueId, since: number | null, issues: IssueStore): Promise<number | null> {
  return since === null ? null : issues.countUsers({ issueId, since });
}

/** The facts an Event's rules read, measured after the Event is recorded so every count includes it. */
async function measure(state: IssueState, summary: EventSummary, isNew: boolean, issues: IssueStore): Promise<EventFacts> {
  const starts = conditionWindowStarts(state, summary.at);
  return {
    at: summary.at,
    release: summary.release,
    isNewUser: isNew,
    hourlyCount: await issues.countEvents({ issueId: state.issueId, since: hourStart(summary.at) }),
    projectNormalRate: await issues.projectNormalRate(),
    conditionWindowCount: await countSince(state.issueId, starts.events, issues),
    conditionWindowUserCount: await usersSince(state.issueId, starts.users, issues),
  };
}

// --- flow: writing ---

async function write(transition: IssueTransition, issues: IssueStore): Promise<void> {
  await issues.putIssue(transition.state);
  await issues.appendHistory(transition.changes);
}

async function record(issueId: IssueId, placement: Placement, issues: IssueStore): Promise<void> {
  await issues.recordEvent(issueId, placement);
  await issues.attachFingerprints(issueId, placement.fingerprints);
}

// --- flow: placing ---

async function openIssue(placement: Placement, deps: AssignEventDeps): Promise<Assignment> {
  const issueId = deps.ids.newId();
  const { summary } = placement;
  const opened = createIssue({ issueId, at: summary.at, level: summary.level, isNewUser: summary.userKey !== null });
  await deps.issues.assignShortId(issueId);
  await write(opened, deps.issues);
  await record(issueId, placement, deps.issues);
  return joined(issueId, opened.changes);
}

async function joinIssue(issueId: IssueId, placement: Placement, deps: AssignEventDeps): Promise<Assignment> {
  const { issues } = deps;
  const state = await issues.getIssue(issueId);
  if (state === null) throw new Error(`IssueStore holds a Fingerprint of missing issue ${issueId}`);
  const isNew = await isNewUser(issueId, placement.summary, issues);
  await record(issueId, placement, issues);
  const facts = await measure(state, placement.summary, isNew, issues);
  const context = { policies: deps.policies, forecast: await issues.getForecast(issueId), firstSeen: await issues.releaseFirstSeen() };
  const applied = applyEvent(state, facts, context);
  if (isRefusal(applied)) throw new Error(`event reached issue ${issueId} while it was going away: ${applied.refusal}`);
  await write(applied, issues);
  return joined(issueId, applied.changes);
}

async function place(placement: Placement, deps: AssignEventDeps): Promise<Assignment> {
  const tombstone = await deps.issues.findTombstone(placement.fingerprints);
  if (tombstone) return dropped(tombstone);
  const issueId = await deps.issues.findIssueByFingerprints(placement.fingerprints);
  return issueId === null ? openIssue(placement, deps) : joinIssue(issueId, placement, deps);
}

async function assignInTransaction(placement: Placement, deps: AssignEventDeps): Promise<Assignment> {
  const now = deps.clock.now();
  const earlier = await deps.issues.recallAssignment(placement.summary.eventId, now);
  if (earlier) return duplicateOf(earlier);
  const assignment = await place(placement, deps);
  await deps.issues.rememberAssignment(placement.summary.eventId, targetOf(assignment), now);
  return assignment;
}

// --- exports ---

export async function assignEvent(summary: EventSummary, fingerprints: Fingerprint[], deps: AssignEventDeps): Promise<Assignment> {
  return deps.issues.transact(() => assignInTransaction({ summary, fingerprints }, deps));
}
