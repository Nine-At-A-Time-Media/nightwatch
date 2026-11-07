/**
 * Regrouping -- merging Issues into one and splitting Fingerprints off into
 * a new Issue (design Issues, Merge and Split; State Machine: Issue, merge as
 * a source). An Issue's counts after either are recounted from the Events it
 * then holds, so an Event is never counted twice or lost. The caller moves
 * the Fingerprints and Events; these rules check the request and return the
 * states and Issue Changes to write.
 */

import type { EventSummary } from '../event/event-summary.js';
import type { Fingerprint } from '../grouping/fingerprint.js';
import type { IssueId } from '../ids.js';
import { isRefusal, refusal, type Refusal } from '../refusal.js';
import { beginMerge } from './commands.js';
import { chain, change, enterForReview, goneRefusal, type Actor, type IssueState, type IssueTransition } from './state.js';

export type SplitResult = { readonly from: IssueTransition; readonly split: IssueTransition };

// --- predicates ---

function hasRepeats(ids: readonly IssueId[]): boolean {
  return new Set(ids).size !== ids.length;
}

// --- helpers ---

/** An Issue's counts and first and last seen, recounted from the Events it holds. */
export function recount(state: IssueState, events: readonly EventSummary[]): IssueState {
  const times = events.map((event) => event.at);
  const users = new Set(events.flatMap((event) => (event.userKey === null ? [] : [event.userKey])));
  return {
    ...state,
    count: events.length,
    userCount: users.size,
    firstSeen: times.length > 0 ? Math.min(...times) : state.firstSeen,
    lastSeen: times.length > 0 ? Math.max(...times) : state.lastSeen,
  };
}

function openedFrom(from: IssueState, entry: { issueId: IssueId; moved: readonly EventSummary[]; at: number }): IssueState {
  const opened: IssueState = {
    issueId: entry.issueId,
    substatusSince: entry.at,
    firstSeen: entry.at,
    lastSeen: entry.at,
    count: 0,
    userCount: 0,
    priority: from.priority,
    forReviewSince: null,
    status: 'unresolved',
    substatus: 'new',
  };
  return recount(opened, entry.moved);
}

// --- merge ---

export function mergeRefusal(request: { target: IssueId; sources: readonly IssueId[] }): Refusal | null {
  if (request.sources.length === 0) return refusal('merge_needs_sources');
  if (request.sources.includes(request.target)) return refusal('merge_into_itself');
  if (hasRepeats(request.sources)) return refusal('merge_source_repeated');
  return null;
}

/** Moves every source to Merging; refused if any one of them is already going away. */
export function beginMerges(sources: readonly IssueState[], actor: Actor, at: number): IssueTransition[] | Refusal {
  const begun = sources.map((source) => beginMerge(source, actor, at));
  const refused = begun.find(isRefusal);
  return refused ?? begun.filter((transition): transition is IssueTransition => !isRefusal(transition));
}

/** The target recounted over all the Events it now holds, with one merge change per source. */
export function absorbMerge(merge: {
  target: IssueState;
  sources: readonly IssueId[];
  events: readonly EventSummary[];
  actor: Actor;
  at: number;
}): IssueTransition | Refusal {
  const gone = goneRefusal(merge.target);
  if (gone) return gone;
  const state = recount(merge.target, merge.events);
  const changes = merge.sources.map((source) =>
    change(state, { kind: 'merge', from: source, to: state.issueId, actor: merge.actor, at: merge.at }),
  );
  return { state, changes };
}

// --- split ---

export function splitRefusal(request: { held: readonly Fingerprint[]; chosen: readonly Fingerprint[] }): Refusal | null {
  if (request.chosen.length === 0) return refusal('split_needs_fingerprints');
  if (!request.chosen.every((fingerprint) => request.held.includes(fingerprint))) return refusal('fingerprint_not_held');
  if (request.held.every((fingerprint) => request.chosen.includes(fingerprint))) return refusal('split_leaves_nothing');
  return null;
}

/** The Issue split from, recounted over the Events it keeps, and the new Unresolved/New Issue holding the moved ones. */
export function splitOff(split: {
  from: IssueState;
  issueId: IssueId;
  remaining: readonly EventSummary[];
  moved: readonly EventSummary[];
  actor: Actor;
  at: number;
}): SplitResult | Refusal {
  const gone = goneRefusal(split.from);
  if (gone) return gone;
  const entry = { kind: 'split' as const, from: split.from.issueId, to: split.issueId, actor: split.actor, at: split.at };
  const kept = recount(split.from, split.remaining);
  const opened = openedFrom(split.from, { issueId: split.issueId, moved: split.moved, at: split.at });
  const created = { kind: 'status' as const, from: null, to: 'unresolved/new', actor: split.actor, at: split.at };
  const newIssue = { state: opened, changes: [change(opened, created), change(opened, entry)] };
  return {
    from: { state: kept, changes: [change(kept, entry)] },
    split: chain(newIssue, (s) => enterForReview(s, split.at)),
  };
}
