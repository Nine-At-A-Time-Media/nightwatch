/**
 * IssuePolicies -- the timing and escalation parameters of the issue
 * lifecycle (design Parameters: New Issue Age, Settle Age, Inbox Expiry,
 * Auto-Resolve Age, Early Escalation Policy thresholds, Forecast window),
 * and the Early Escalation Policy itself. Durations are milliseconds. The
 * domain holds no defaults: the composition root supplies every value.
 */

import type { ForecastPolicy } from './forecast.js';

export type EarlyEscalationPolicy = {
  /** An Issue younger than this is young. */
  readonly youngAge: number;
  /** The fewest events a young Issue needs before it can escalate early. */
  readonly minimumCount: number;
  /** How many times its project's normal hourly rate the Issue's hourly count must reach. */
  readonly rateMultiple: number;
};

export type IssuePolicies = {
  readonly newIssueAge: number;
  readonly settleAge: number;
  readonly inboxExpiry: number;
  /** Null means the Project never auto-resolves. */
  readonly autoResolveAge: number | null;
  readonly earlyEscalation: EarlyEscalationPolicy;
  readonly forecast: ForecastPolicy;
};

// --- predicates ---

/** The Early Escalation Policy: young, already frequent, and well above its project's normal rate. */
export function holdsEarlyEscalation(
  policy: EarlyEscalationPolicy,
  issue: { age: number; count: number; hourlyCount: number; projectNormalRate: number },
): boolean {
  return (
    issue.age < policy.youngAge && issue.count >= policy.minimumCount && issue.hourlyCount >= policy.rateMultiple * issue.projectNormalRate
  );
}
