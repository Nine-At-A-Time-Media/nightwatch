/**
 * Metric Alert Rule and Incident -- thresholds over an aggregate, and the
 * Incident they open and close (design Alerts and notifications, Metric
 * Alert Rule; State Machine: Metric Incident; Parameters: metric alert
 * window, consecutive breach count, consecutive recovery count).
 *
 * Each evaluation measures one value over the rule's window and steps the
 * Incident. A value breaches a threshold when it is past it in the rule's
 * direction (strictly above, or strictly below). It recovers when it is at
 * or on the good side of the resolve threshold, which defaults to the
 * lowest threshold the rule has. Level changes need consecutive values:
 *
 *   closed   -> critical  breachesToOpen critical breaches
 *   closed   -> warning   breachesToOpen warning breaches (a critical value
 *                         also breaches the warning threshold)
 *   warning  -> critical  breachesToOpen critical breaches
 *   critical -> warning   breachesToOpen values breaching warning but not
 *                         critical
 *   warning, critical -> closed  recoveriesToClose recoveries, or a member
 *                         closes it
 *
 * Every level change is an Incident Change, which notifies. Times are epoch
 * milliseconds.
 */

import type { Member } from '../issue/state.js';
import { refusal, type Refusal } from '../refusal.js';

export type MetricAggregate = 'event_count' | 'user_count' | 'crash_free_rate';

export type MetricAlertRule = {
  readonly ruleId: string;
  readonly aggregate: MetricAggregate;
  readonly windowMs: number;
  /** `above`: a value over a threshold breaches it; `below`: a value under it does. */
  readonly comparison: 'above' | 'below';
  readonly critical: number;
  readonly warning: number | null;
  /** The value past which the aggregate has recovered; null means the lowest threshold. */
  readonly resolve: number | null;
  readonly breachesToOpen: number;
  readonly recoveriesToClose: number;
};

export type IncidentLevel = 'closed' | 'warning' | 'critical';

/** The current level and the runs of consecutive values that move it. */
export type IncidentState = {
  readonly level: IncidentLevel;
  readonly criticalBreaches: number;
  /** Consecutive values breaching the warning threshold, critical values included. */
  readonly warningBreaches: number;
  /** Consecutive values breaching the warning threshold but not the critical one. */
  readonly warningOnlyBreaches: number;
  readonly recoveries: number;
};

/** One change of an Incident's level. `value` is the measured value; null when a member closed it. */
export type IncidentChange = {
  readonly ruleId: string;
  readonly from: IncidentLevel;
  readonly to: IncidentLevel;
  readonly at: number;
  readonly value: number | null;
  readonly actor: Member | 'system';
};

export type IncidentStep = { readonly state: IncidentState; readonly change: IncidentChange | null };

// --- predicates ---

function isPast(rule: MetricAlertRule, value: number, threshold: number): boolean {
  return rule.comparison === 'above' ? value > threshold : value < threshold;
}

function isAtOrBefore(rule: MetricAlertRule, value: number, threshold: number): boolean {
  return !isPast(rule, value, threshold);
}

function isWarningBreach(rule: MetricAlertRule, value: number): boolean {
  return rule.warning !== null && isPast(rule, value, rule.warning);
}

function isRecovered(rule: MetricAlertRule, value: number): boolean {
  return isAtOrBefore(rule, value, resolveThreshold(rule));
}

function isValidRule(rule: MetricAlertRule): boolean {
  const countsValid =
    Number.isInteger(rule.breachesToOpen) &&
    rule.breachesToOpen >= 1 &&
    Number.isInteger(rule.recoveriesToClose) &&
    rule.recoveriesToClose >= 1;
  const warningValid = rule.warning === null || isPast(rule, rule.critical, rule.warning);
  const resolveValid = rule.resolve === null || isAtOrBefore(rule, rule.resolve, lowestThreshold(rule));
  return rule.windowMs > 0 && countsValid && warningValid && resolveValid;
}

// --- helpers ---

function lowestThreshold(rule: MetricAlertRule): number {
  return rule.warning ?? rule.critical;
}

function resolveThreshold(rule: MetricAlertRule): number {
  return rule.resolve ?? lowestThreshold(rule);
}

function runOf(count: number, holds: boolean): number {
  return holds ? count + 1 : 0;
}

function countRuns(rule: MetricAlertRule, state: IncidentState, value: number): IncidentState {
  const critical = isPast(rule, value, rule.critical);
  const warning = isWarningBreach(rule, value);
  return {
    level: state.level,
    criticalBreaches: runOf(state.criticalBreaches, critical),
    warningBreaches: runOf(state.warningBreaches, warning),
    warningOnlyBreaches: runOf(state.warningOnlyBreaches, warning && !critical),
    recoveries: runOf(state.recoveries, isRecovered(rule, value)),
  };
}

function nextLevel(rule: MetricAlertRule, runs: IncidentState): IncidentLevel {
  const n = rule.breachesToOpen;
  switch (runs.level) {
    case 'closed':
      if (runs.criticalBreaches >= n) return 'critical';
      return runs.warningBreaches >= n ? 'warning' : 'closed';
    case 'warning':
      if (runs.criticalBreaches >= n) return 'critical';
      return runs.recoveries >= rule.recoveriesToClose ? 'closed' : 'warning';
    case 'critical':
      if (runs.warningOnlyBreaches >= n) return 'warning';
      return runs.recoveries >= rule.recoveriesToClose ? 'closed' : 'critical';
  }
}

// --- exports ---

/** The rule, or a Refusal when a count is below one, the window is empty, or the thresholds are out of order. */
export function metricAlertRule(rule: MetricAlertRule): MetricAlertRule | Refusal {
  return isValidRule(rule) ? rule : refusal('metric_alert_rule_invalid');
}

/** A rule's Incident before any evaluation: closed, with no runs. */
export function closedIncident(): IncidentState {
  return { level: 'closed', criticalBreaches: 0, warningBreaches: 0, warningOnlyBreaches: 0, recoveries: 0 };
}

/** Steps the Incident with one measured value; the change is null when the level stays. */
export function stepIncident({
  rule,
  state,
  value,
  at,
}: {
  rule: MetricAlertRule;
  state: IncidentState;
  value: number;
  at: number;
}): IncidentStep {
  const runs = countRuns(rule, state, value);
  const level = nextLevel(rule, runs);
  if (level === state.level) return { state: runs, change: null };
  return { state: { ...runs, level }, change: { ruleId: rule.ruleId, from: state.level, to: level, at, value, actor: 'system' } };
}

/** A member closes the Incident; closing a closed Incident changes nothing. */
export function closeIncident({
  rule,
  state,
  member,
  at,
}: {
  rule: MetricAlertRule;
  state: IncidentState;
  member: Member;
  at: number;
}): IncidentStep {
  if (state.level === 'closed') return { state, change: null };
  return { state: closedIncident(), change: { ruleId: rule.ruleId, from: state.level, to: 'closed', at, value: null, actor: member } };
}
