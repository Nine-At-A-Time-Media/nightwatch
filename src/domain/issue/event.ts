/**
 * Issue creation and event application -- what one Event does to its Issue
 * (design State Machine: Issue, rows triggered by an event): it is counted;
 * it may regress a resolved Issue, unarchive an archived one, or escalate a
 * New one early. Every transition is returned with its Issue Changes.
 *
 * The caller measures the counts an Event's rules read (EventFacts): the
 * Issue's events in the current hour including this one, its project's
 * normal hourly rate, and, for an Issue archived until a windowed count,
 * the events and users inside that window including this one.
 */

import type { Release, ReleaseFirstSeen } from '../release/ordering.js';
import type { Refusal } from '../refusal.js';
import { exceedsForecast, type Forecast } from './forecast.js';
import { holdsEarlyEscalation, type IssuePolicies } from './policies.js';
import { initialPriority, raisePriority, type Level } from './priority.js';
import { isRegression } from './resolution.js';
import {
  chain,
  change,
  enterForReview,
  goneRefusal,
  isUntilDatePassed,
  moveTo,
  unchanged,
  type IssueState,
  type IssueTransition,
  type SnoozeCondition,
} from './state.js';

export type EventFacts = {
  readonly at: number;
  readonly release: Release | null;
  readonly isNewUser: boolean;
  readonly hourlyCount: number;
  readonly projectNormalRate: number;
  readonly conditionWindowCount: number | null;
  readonly conditionWindowUserCount: number | null;
};

export type EventContext = {
  readonly policies: IssuePolicies;
  /** The Issue's current Forecast; null until one has been computed. */
  readonly forecast: Forecast | null;
  readonly firstSeen: ReleaseFirstSeen;
};

// --- predicates ---

function isCountMet(target: number | null, measured: number): boolean {
  return target !== null && measured >= target;
}

function isConditionMet(condition: SnoozeCondition, state: IssueState, event: EventFacts): boolean {
  const count = condition.window === null ? state.count - condition.baselineCount : (event.conditionWindowCount ?? 0);
  const users = condition.userWindow === null ? state.userCount - condition.baselineUserCount : (event.conditionWindowUserCount ?? 0);
  return isUntilDatePassed(condition, event.at) || isCountMet(condition.count, count) || isCountMet(condition.userCount, users);
}

function isEarlyEscalation(state: IssueState, event: EventFacts, policies: IssuePolicies): boolean {
  return holdsEarlyEscalation(policies.earlyEscalation, {
    age: event.at - state.firstSeen,
    count: state.count,
    hourlyCount: event.hourlyCount,
    projectNormalRate: event.projectNormalRate,
  });
}

// --- helpers ---

function counted(state: IssueState, event: EventFacts): IssueState {
  return {
    ...state,
    count: state.count + 1,
    userCount: state.userCount + (event.isNewUser ? 1 : 0),
    lastSeen: Math.max(state.lastSeen, event.at),
  };
}

function raisedPriority(state: IssueState, at: number): IssueTransition {
  const priority = raisePriority(state.priority);
  if (priority.level === state.priority.level) return unchanged(state);
  return {
    state: { ...state, priority },
    changes: [change(state, { kind: 'priority', from: state.priority.level, to: priority.level, actor: 'system', at })],
  };
}

function escalate(state: IssueState, at: number): IssueTransition {
  const moved = moveTo(state, { status: 'unresolved', substatus: 'escalating' }, 'system', at);
  return chain(
    chain(moved, (s) => raisedPriority(s, at)),
    (s) => enterForReview(s, at),
  );
}

function reopenAs(state: IssueState, substatus: 'ongoing' | 'regressed', at: number): IssueTransition {
  return chain(moveTo(state, { status: 'unresolved', substatus }, 'system', at), (s) => enterForReview(s, at));
}

function transitionOnEvent(state: IssueState, event: EventFacts, context: EventContext): IssueTransition {
  if (state.status === 'resolved') {
    return isRegression(state.resolution, event.release, context.firstSeen) ? reopenAs(state, 'regressed', event.at) : unchanged(state);
  }
  if (state.status === 'archived' && state.substatus === 'until_escalating') {
    return context.forecast && exceedsForecast(context.forecast, event.hourlyCount) ? escalate(state, event.at) : unchanged(state);
  }
  if (state.status === 'archived' && state.substatus === 'until_condition') {
    return isConditionMet(state.condition, state, event) ? reopenAs(state, 'ongoing', event.at) : unchanged(state);
  }
  if (state.status === 'unresolved' && state.substatus === 'new') {
    return isEarlyEscalation(state, event, context.policies) ? escalate(state, event.at) : unchanged(state);
  }
  return unchanged(state);
}

// --- exports ---

/** The first event of a Fingerprint opens an Unresolved/New Issue in For Review. */
export function createIssue(first: { issueId: string; at: number; level: Level; isNewUser: boolean }): IssueTransition {
  const state: IssueState = {
    issueId: first.issueId,
    substatusSince: first.at,
    firstSeen: first.at,
    lastSeen: first.at,
    count: 1,
    userCount: first.isNewUser ? 1 : 0,
    priority: initialPriority(first.level),
    forReviewSince: null,
    status: 'unresolved',
    substatus: 'new',
  };
  const opened = { state, changes: [change(state, { kind: 'status', from: null, to: 'unresolved/new', actor: 'system', at: first.at })] };
  return chain(opened, (s) => enterForReview(s, first.at));
}

/** Counts one Event against its Issue and applies the transitions it triggers. Refused while the Issue is being deleted or merged. */
export function applyEvent(state: IssueState, event: EventFacts, context: EventContext): IssueTransition | Refusal {
  return goneRefusal(state) ?? transitionOnEvent(counted(state, event), event, context);
}
