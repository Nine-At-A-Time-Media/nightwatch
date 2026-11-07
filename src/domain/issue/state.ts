/**
 * Issue state -- an Issue's Status and Substatus, its counts, Priority and
 * For Review standing (design State Machine: Issue), and the Issue Changes
 * every transition records in its History. Transitions elsewhere in
 * src/domain/issue return an IssueTransition: the next state and the
 * changes, which the caller writes together.
 *
 * Times and durations are epoch milliseconds.
 */

import { refusal, type Refusal } from '../refusal.js';
import type { Priority } from './priority.js';
import type { Resolution } from './resolution.js';

export type UnresolvedSubstatus = 'new' | 'ongoing' | 'escalating' | 'regressed';
export type ArchivedSubstatus = 'until_escalating' | 'until_condition' | 'forever';

/**
 * What an Issue archived until a condition waits for. Any one of a date, a
 * count or a user count met unarchives it. A count with a window counts only
 * events inside that window; without one it counts events since archiving,
 * against the baseline taken then.
 */
export type SnoozeCondition = {
  readonly untilDate: number | null;
  readonly count: number | null;
  readonly window: number | null;
  readonly userCount: number | null;
  readonly userWindow: number | null;
  readonly baselineCount: number;
  readonly baselineUserCount: number;
};

/** Status and Substatus, with what each place in the State Machine carries. */
export type Status =
  | { readonly status: 'unresolved'; readonly substatus: UnresolvedSubstatus }
  | { readonly status: 'resolved'; readonly resolution: Resolution }
  | { readonly status: 'archived'; readonly substatus: 'until_escalating' }
  | { readonly status: 'archived'; readonly substatus: 'until_condition'; readonly condition: SnoozeCondition }
  /** `spam` marks a Report issue archived as spam, whose reporter is told nothing. */
  | { readonly status: 'archived'; readonly substatus: 'forever'; readonly spam: boolean }
  | { readonly status: 'deleting' }
  | { readonly status: 'merging' };

export type IssueStateBase = {
  readonly issueId: string;
  /** When the Issue entered its current Status and Substatus. */
  readonly substatusSince: number;
  readonly firstSeen: number;
  readonly lastSeen: number;
  readonly count: number;
  readonly userCount: number;
  readonly priority: Priority;
  /** When the Issue entered For Review; null when it is not in For Review. */
  readonly forReviewSince: number | null;
};

export type IssueState = IssueStateBase & Status;

/** Who or what made a change: a Member, a Report's Reporter, or the named part of Nightwatch. */
export type Actor = Member | 'system' | 'tracker' | 'commit' | 'sweep' | 'reporter' | 'spam_judge';

/** Where a change came from, so it is never echoed back there. */
export type Origin = 'nightwatch' | 'tracker';

/** A Member, as an Actor. */
export type Member = { readonly member: string };

/**
 * `merge` and `split` changes name the Issue the Events came from and the one
 * they went to; a `comment` change names the Comment saved, never its text.
 */
export type IssueChangeKind = 'status' | 'priority' | 'resolution' | 'for_review' | 'merge' | 'split' | 'comment';

/** One entry of an Issue's History. */
export type IssueChange = {
  readonly issueId: string;
  readonly kind: IssueChangeKind;
  readonly from: string | null;
  readonly to: string | null;
  readonly actor: Actor;
  readonly origin: Origin;
  readonly at: number;
};

export type IssueTransition = { readonly state: IssueState; readonly changes: readonly IssueChange[] };

// --- predicates ---

export function isInForReview(state: IssueState): boolean {
  return state.forReviewSince !== null;
}

export function isUntilDatePassed(condition: SnoozeCondition, now: number): boolean {
  return condition.untilDate !== null && now >= condition.untilDate;
}

// --- helpers ---

export function originOf(actor: Actor): Origin {
  return actor === 'tracker' ? 'tracker' : 'nightwatch';
}

/** The History label of a Status: `unresolved/new`, `resolved`, `archived/forever`, `deleting`. */
export function statusLabel(status: Status): string {
  return 'substatus' in status ? `${status.status}/${status.substatus}` : status.status;
}

export function baseOf(state: IssueState): IssueStateBase {
  return {
    issueId: state.issueId,
    substatusSince: state.substatusSince,
    firstSeen: state.firstSeen,
    lastSeen: state.lastSeen,
    count: state.count,
    userCount: state.userCount,
    priority: state.priority,
    forReviewSince: state.forReviewSince,
  };
}

export function statusOf(state: IssueState): Status {
  switch (state.status) {
    case 'unresolved':
      return { status: state.status, substatus: state.substatus };
    case 'resolved':
      return { status: state.status, resolution: state.resolution };
    case 'archived':
      if (state.substatus === 'until_condition') return { status: state.status, substatus: state.substatus, condition: state.condition };
      if (state.substatus === 'forever') return { status: state.status, substatus: state.substatus, spam: state.spam };
      return { status: state.status, substatus: state.substatus };
    default:
      return { status: state.status };
  }
}

export function change(
  state: IssueState,
  entry: { kind: IssueChangeKind; from: string | null; to: string | null; actor: Actor; at: number },
): IssueChange {
  return { issueId: state.issueId, ...entry, origin: originOf(entry.actor) };
}

/** Composes two transitions: `next` runs on the state `first` produced; their changes concatenate. */
export function chain(first: IssueTransition, next: (state: IssueState) => IssueTransition): IssueTransition {
  const second = next(first.state);
  return { state: second.state, changes: [...first.changes, ...second.changes] };
}

export function unchanged(state: IssueState): IssueTransition {
  return { state, changes: [] };
}

/** Moves the Issue to another place in the State Machine, recording the change. */
export function moveTo(state: IssueState, status: Status, actor: Actor, at: number): IssueTransition {
  const next: IssueState = { ...baseOf(state), substatusSince: at, ...status };
  return { state: next, changes: [change(state, { kind: 'status', from: statusLabel(state), to: statusLabel(status), actor, at })] };
}

export function enterForReview(state: IssueState, at: number): IssueTransition {
  if (isInForReview(state)) return unchanged(state);
  return {
    state: { ...state, forReviewSince: at },
    changes: [change(state, { kind: 'for_review', from: null, to: 'in', actor: 'system', at })],
  };
}

export function leaveForReview(state: IssueState, actor: Actor, at: number): IssueTransition {
  if (!isInForReview(state)) return unchanged(state);
  return { state: { ...state, forReviewSince: null }, changes: [change(state, { kind: 'for_review', from: 'in', to: null, actor, at })] };
}

/** The Refusal for acting on an Issue the Project does not hold. */
export function issueNotFound(): Refusal {
  return refusal('issue_not_found');
}

/** The Refusal for acting on an Issue that is going away, or null when it is not. */
export function goneRefusal(state: IssueState): Refusal | null {
  if (state.status === 'deleting') return refusal('issue_deleting');
  if (state.status === 'merging') return refusal('issue_merging');
  return null;
}
