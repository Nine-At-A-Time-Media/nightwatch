/**
 * Issue Alert Rule -- triggers, filters and actions over Issues (design
 * Alerts and notifications; Domain Language: Issue Alert Rule, Alert Quiet
 * Period). `evaluateRule` decides, from values alone, whether one rule fires
 * for one Issue Change or Event.
 *
 * Status triggers read the Issue Change. Frequency triggers fire while the
 * count over their window is above the threshold; the Alert Quiet Period is
 * what keeps a rule that stays above it from firing again for the Issue.
 * An event filter (environment, level, tag, attribute, release) does not
 * pass when no Event arrived. A rule with no filters passes every filter
 * match; a rule with no triggers never fires. Times are epoch milliseconds.
 */

import type { EventSummary } from '../event/event-summary.js';
import { globMatches } from '../ingest/inbound-filters.js';
import type { Level } from '../issue/priority.js';
import type { IssueChange, IssueState } from '../issue/state.js';
import type { Release } from '../release/ordering.js';

export type Trigger =
  | { readonly kind: 'first_seen' }
  | { readonly kind: 'regression' }
  | { readonly kind: 'unarchived' }
  | { readonly kind: 'escalating' }
  | { readonly kind: 'every_event' }
  /** More than `count` events in the Issue over the last `windowMs`. */
  | { readonly kind: 'event_frequency'; readonly count: number; readonly windowMs: number }
  /** More than `count` distinct users in the Issue over the last `windowMs`. */
  | { readonly kind: 'user_frequency'; readonly count: number; readonly windowMs: number };

/** An Issue's Assignee: one Member or one Team. */
export type Assignee = { readonly member: string } | { readonly team: string };

/** A crash Issue groups Events by Fingerprint; a Report issue holds a Report. */
export type IssueKind = 'crash' | 'report';

export type Filter =
  | { readonly kind: 'environment'; readonly environment: string }
  | { readonly kind: 'level'; readonly atLeast: Level }
  /** The Event's tag `key` matches the glob `value`. */
  | { readonly kind: 'tag'; readonly key: string; readonly value: string }
  /** The Event's attribute at `path` matches the glob `value`. */
  | { readonly kind: 'attribute'; readonly path: string; readonly value: string }
  | { readonly kind: 'issue_age'; readonly comparison: 'older' | 'newer'; readonly ageMs: number }
  | { readonly kind: 'assignee'; readonly assignee: Assignee | 'unassigned' }
  | { readonly kind: 'release'; readonly release: 'latest' }
  | { readonly kind: 'issue_kind'; readonly issueKind: IssueKind };

export type EmailRecipient =
  { readonly kind: 'owners' } | { readonly kind: 'team'; readonly team: string } | { readonly kind: 'member'; readonly member: string };

export type Action =
  | { readonly kind: 'email'; readonly to: EmailRecipient }
  | { readonly kind: 'webhook'; readonly url: string }
  | { readonly kind: 'open_github_issue'; readonly repository: string };

export type IssueAlertRule = {
  readonly ruleId: string;
  readonly triggers: readonly Trigger[];
  /** `all`: every trigger must hold; `any`: one is enough. */
  readonly actionMatch: 'all' | 'any';
  readonly filters: readonly Filter[];
  /** `all`: every filter passes; `any`: one passes; `none`: no filter passes. */
  readonly filterMatch: 'all' | 'any' | 'none';
  readonly actions: readonly Action[];
  readonly quietPeriodMs: number;
};

/** The Event an evaluation reads, with the tags and attributes filters match. */
export type AlertEvent = EventSummary & {
  readonly tags: Readonly<Record<string, string>>;
  /** Event attributes by dotted path, such as `exception.type`. */
  readonly attributes: Readonly<Record<string, string>>;
};

/** Counts over the rule's frequency windows, read when the Event arrived. */
export type AlertCounts = { readonly eventsInWindow: number; readonly usersInWindow: number };

export type AlertContext = {
  /** The Issue Change evaluated; null when an Event arrived without changing the Issue's state. */
  readonly change: IssueChange | null;
  readonly issue: IssueState;
  readonly issueKind: IssueKind;
  readonly assignee: Assignee | null;
  /** The Event that arrived; null when the change came from no Event. */
  readonly event: AlertEvent | null;
  readonly counts: AlertCounts;
  /** When this rule last fired for this Issue; null when it never has. */
  readonly lastFiredAt: number | null;
  readonly now: number;
  readonly latestRelease: Release | null;
};

export type RuleEvaluationReason = 'fired' | 'no_trigger' | 'filtered' | 'quiet_period';

export type RuleEvaluation = { readonly fire: boolean; readonly reason: RuleEvaluationReason };

const LEVEL_RANK: Readonly<Record<Level, number>> = { debug: 0, info: 1, warning: 2, error: 3, fatal: 4 };

// --- predicates: triggers ---

function isStatusChange(change: IssueChange | null): change is IssueChange {
  return change !== null && change.kind === 'status';
}

function isUnresolvedLabel(label: string | null): boolean {
  return label !== null && label.startsWith('unresolved/');
}

function isArchivedLabel(label: string | null): boolean {
  return label !== null && label.startsWith('archived/');
}

function isTriggerMet(trigger: Trigger, context: AlertContext): boolean {
  const { change } = context;
  switch (trigger.kind) {
    case 'first_seen':
      return isStatusChange(change) && change.from === null && change.to === 'unresolved/new';
    case 'regression':
      return isStatusChange(change) && change.to === 'unresolved/regressed';
    case 'unarchived':
      return isStatusChange(change) && isArchivedLabel(change.from) && isUnresolvedLabel(change.to);
    case 'escalating':
      return isStatusChange(change) && change.to === 'unresolved/escalating';
    case 'every_event':
      return context.event !== null;
    case 'event_frequency':
      return context.counts.eventsInWindow > trigger.count;
    case 'user_frequency':
      return context.counts.usersInWindow > trigger.count;
  }
}

function areTriggersMet(rule: IssueAlertRule, context: AlertContext): boolean {
  if (rule.triggers.length === 0) return false;
  return rule.actionMatch === 'all'
    ? rule.triggers.every((trigger) => isTriggerMet(trigger, context))
    : rule.triggers.some((trigger) => isTriggerMet(trigger, context));
}

// --- predicates: filters ---

function isSameAssignee(wanted: Assignee | 'unassigned', actual: Assignee | null): boolean {
  if (wanted === 'unassigned' || actual === null) return wanted === 'unassigned' && actual === null;
  if ('member' in wanted) return 'member' in actual && actual.member === wanted.member;
  return 'team' in actual && actual.team === wanted.team;
}

function isGlobValue(pattern: string, value: string | undefined): boolean {
  return value !== undefined && globMatches({ pattern, text: value });
}

function isEventFilterPassed(filter: Filter, event: AlertEvent, latestRelease: Release | null): boolean {
  switch (filter.kind) {
    case 'environment':
      return event.environment === filter.environment;
    case 'level':
      return LEVEL_RANK[event.level] >= LEVEL_RANK[filter.atLeast];
    case 'tag':
      return isGlobValue(filter.value, event.tags[filter.key]);
    case 'attribute':
      return isGlobValue(filter.value, event.attributes[filter.path]);
    case 'release':
      return latestRelease !== null && event.release === latestRelease;
    default:
      return false;
  }
}

function isFilterPassed(filter: Filter, context: AlertContext): boolean {
  switch (filter.kind) {
    case 'issue_age': {
      const age = context.now - context.issue.firstSeen;
      return filter.comparison === 'older' ? age > filter.ageMs : age < filter.ageMs;
    }
    case 'assignee':
      return isSameAssignee(filter.assignee, context.assignee);
    case 'issue_kind':
      return context.issueKind === filter.issueKind;
    default:
      return context.event !== null && isEventFilterPassed(filter, context.event, context.latestRelease);
  }
}

function areFiltersPassed(rule: IssueAlertRule, context: AlertContext): boolean {
  switch (rule.filterMatch) {
    case 'all':
      return rule.filters.every((filter) => isFilterPassed(filter, context));
    case 'any':
      return rule.filters.length === 0 || rule.filters.some((filter) => isFilterPassed(filter, context));
    case 'none':
      return !rule.filters.some((filter) => isFilterPassed(filter, context));
  }
}

// --- predicates: quiet period ---

function isInQuietPeriod(rule: IssueAlertRule, context: AlertContext): boolean {
  return context.lastFiredAt !== null && context.now - context.lastFiredAt < rule.quietPeriodMs;
}

// --- exports ---

/** Whether the rule fires for this Issue now, and why not when it does not. */
export function evaluateRule(rule: IssueAlertRule, context: AlertContext): RuleEvaluation {
  if (!areTriggersMet(rule, context)) return { fire: false, reason: 'no_trigger' };
  if (!areFiltersPassed(rule, context)) return { fire: false, reason: 'filtered' };
  if (isInQuietPeriod(rule, context)) return { fire: false, reason: 'quiet_period' };
  return { fire: true, reason: 'fired' };
}
