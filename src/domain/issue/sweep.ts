/**
 * Issue sweep -- the transitions the passage of time triggers (design State
 * Machine: Issue, rows triggered by sweep or age; Inbox; Auto-resolve), run
 * on one Issue at one moment. Steps run in a fixed order so a second sweep
 * at the same moment finds nothing left to do:
 *
 * 1. New becomes Ongoing past the New Issue Age; Escalating and Regressed
 *    settle to Ongoing past the Settle Age in that state.
 * 2. An Issue archived until a date that has passed becomes Ongoing and
 *    enters For Review.
 * 3. An Issue in For Review longer than the Inbox Expiry leaves it.
 * 4. An unresolved Issue not seen for the Auto-Resolve Age is resolved.
 *
 * Ages are strict: an Issue exactly at an age has not passed it.
 */

import { resolve } from './commands.js';
import type { IssuePolicies } from './policies.js';
import { isRefusal } from '../refusal.js';
import {
  chain,
  enterForReview,
  isUntilDatePassed,
  leaveForReview,
  moveTo,
  unchanged,
  type IssueState,
  type IssueTransition,
} from './state.js';

// --- predicates ---

function isAged(state: IssueState, now: number, policies: IssuePolicies): boolean {
  if (state.status !== 'unresolved') return false;
  if (state.substatus === 'new') return now - state.firstSeen > policies.newIssueAge;
  if (state.substatus === 'escalating' || state.substatus === 'regressed') return now - state.substatusSince > policies.settleAge;
  return false;
}

function isSnoozeOver(state: IssueState, now: number): boolean {
  return state.status === 'archived' && state.substatus === 'until_condition' && isUntilDatePassed(state.condition, now);
}

function isReviewExpired(state: IssueState, now: number, policies: IssuePolicies): boolean {
  return state.forReviewSince !== null && now - state.forReviewSince > policies.inboxExpiry;
}

function isAutoResolvable(state: IssueState, now: number, policies: IssuePolicies): boolean {
  return state.status === 'unresolved' && policies.autoResolveAge !== null && now - state.lastSeen > policies.autoResolveAge;
}

// --- helpers ---

function settle(state: IssueState, now: number, policies: IssuePolicies): IssueTransition {
  return isAged(state, now, policies) ? moveTo(state, { status: 'unresolved', substatus: 'ongoing' }, 'sweep', now) : unchanged(state);
}

function wake(state: IssueState, now: number): IssueTransition {
  if (!isSnoozeOver(state, now)) return unchanged(state);
  return chain(moveTo(state, { status: 'unresolved', substatus: 'ongoing' }, 'sweep', now), (s) => enterForReview(s, now));
}

function expireReview(state: IssueState, now: number, policies: IssuePolicies): IssueTransition {
  return isReviewExpired(state, now, policies) ? leaveForReview(state, 'sweep', now) : unchanged(state);
}

function autoResolve(state: IssueState, now: number, policies: IssuePolicies): IssueTransition {
  if (!isAutoResolvable(state, now, policies)) return unchanged(state);
  const resolved = resolve(state, { kind: 'plain' }, 'sweep', now);
  return isRefusal(resolved) ? unchanged(state) : resolved;
}

// --- exports ---

export function sweep(state: IssueState, now: number, policies: IssuePolicies): IssueTransition {
  if (state.status === 'deleting' || state.status === 'merging') return unchanged(state);
  const settled = chain(settle(state, now, policies), (s) => wake(s, now));
  return chain(
    chain(settled, (s) => expireReview(s, now, policies)),
    (s) => autoResolve(s, now, policies),
  );
}
