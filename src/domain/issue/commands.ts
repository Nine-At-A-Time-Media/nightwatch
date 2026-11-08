/**
 * Issue commands -- the transitions a Member, the tracker, a commit or the
 * Spam Judge asks for (design State Machine: Issue, rows triggered by a
 * member, commit, GitHub or spam). Each checks the transition table and
 * returns the next state with its Issue Changes, or a Refusal. Every triage
 * command takes the Issue out of For Review. Assignment is not modelled
 * here; its caller marks the Issue reviewed.
 */

import { refusal, type Refusal } from '../refusal.js';
import type { PriorityLevel } from './priority.js';
import { resolutionLabel, type Resolution } from './resolution.js';
import {
  chain,
  change,
  goneRefusal,
  leaveForReview,
  moveTo,
  type Actor,
  type IssueState,
  type IssueTransition,
  type SnoozeCondition,
  type Status,
} from './state.js';

/** How a Member archives an Issue. A condition names at least one of a date, a count or a user count. */
export type ArchiveVariant =
  | { readonly substatus: 'until_escalating' }
  | { readonly substatus: 'until_condition'; readonly condition: Omit<SnoozeCondition, 'baselineCount' | 'baselineUserCount'> }
  | { readonly substatus: 'forever'; readonly spam: boolean };

const NOT_ALLOWED = refusal('transition_not_allowed');

// --- predicates ---

function namesAnyCondition(condition: Extract<ArchiveVariant, { substatus: 'until_condition' }>): boolean {
  const { untilDate, count, userCount } = condition.condition;
  return untilDate !== null || count !== null || userCount !== null;
}

// --- helpers ---

function triaged(transition: IssueTransition, actor: Actor, at: number): IssueTransition {
  return chain(transition, (s) => leaveForReview(s, actor, at));
}

function archivedStatus(state: IssueState, variant: ArchiveVariant): Status {
  if (variant.substatus === 'until_condition') {
    return {
      status: 'archived',
      substatus: variant.substatus,
      condition: { ...variant.condition, baselineCount: state.count, baselineUserCount: state.userCount },
    };
  }
  return { status: 'archived', ...variant };
}

function recordResolution(state: IssueState, resolution: Resolution, actor: Actor, at: number): IssueTransition {
  return { state, changes: [change(state, { kind: 'resolution', from: null, to: resolutionLabel(resolution), actor, at })] };
}

function toOngoing(state: IssueState, actor: Actor, at: number): IssueTransition {
  return triaged(moveTo(state, { status: 'unresolved', substatus: 'ongoing' }, actor, at), actor, at);
}

// --- exports ---

/** Unresolved/* to Resolved: by a member, a commit, a tracker close as completed, or auto-resolve. */
export function resolve(state: IssueState, resolution: Resolution, actor: Actor, at: number): IssueTransition | Refusal {
  const gone = goneRefusal(state);
  if (gone) return gone;
  if (state.status !== 'unresolved') return NOT_ALLOWED;
  const moved = chain(moveTo(state, { status: 'resolved', resolution }, actor, at), (s) => recordResolution(s, resolution, actor, at));
  return triaged(moved, actor, at);
}

/** Unresolved/* to Archived: by a member, the Spam Judge, or a tracker close as not planned (forever). */
export function archive(state: IssueState, variant: ArchiveVariant, actor: Actor, at: number): IssueTransition | Refusal {
  const gone = goneRefusal(state);
  if (gone) return gone;
  if (state.status !== 'unresolved') return NOT_ALLOWED;
  if (variant.substatus === 'until_condition' && !namesAnyCondition(variant)) return refusal('condition_required');
  return triaged(moveTo(state, archivedStatus(state, variant), actor, at), actor, at);
}

/** Archived/* to Unresolved/Ongoing: by a member or a tracker reopen. */
export function unarchive(state: IssueState, actor: Actor, at: number): IssueTransition | Refusal {
  const gone = goneRefusal(state);
  if (gone) return gone;
  return state.status === 'archived' ? toOngoing(state, actor, at) : NOT_ALLOWED;
}

/** Resolved to Unresolved/Ongoing: by a member or a tracker reopen. */
export function unresolve(state: IssueState, actor: Actor, at: number): IssueTransition | Refusal {
  const gone = goneRefusal(state);
  if (gone) return gone;
  return state.status === 'resolved' ? toOngoing(state, actor, at) : NOT_ALLOWED;
}

/** A Priority set this way is hand-set, and is never changed automatically afterwards. */
export function setPriority(state: IssueState, level: PriorityLevel, actor: Actor, at: number): IssueTransition | Refusal {
  const gone = goneRefusal(state);
  if (gone) return gone;
  const set = {
    state: { ...state, priority: { level, setByHand: true } },
    changes: [change(state, { kind: 'priority', from: state.priority.level, to: level, actor, at })],
  };
  return triaged(set, actor, at);
}

export function markReviewed(state: IssueState, actor: Actor, at: number): IssueTransition | Refusal {
  return goneRefusal(state) ?? leaveForReview(state, actor, at);
}

/** Any state to Deleting, by a member's delete or discard. */
export function beginDeletion(state: IssueState, actor: Actor, at: number): IssueTransition | Refusal {
  return goneRefusal(state) ?? moveTo(state, { status: 'deleting' }, actor, at);
}

/** Any state to Merging, for an Issue merged as a source. */
export function beginMerge(state: IssueState, actor: Actor, at: number): IssueTransition | Refusal {
  return goneRefusal(state) ?? moveTo(state, { status: 'merging' }, actor, at);
}
