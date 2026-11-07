/**
 * Report Status -- what a Reporter is told about their Report, derived from
 * the state of the Issue it is attached to and that Issue's External Link
 * (design State Machine: Report Status). Nothing sets it directly.
 *
 * Triage is an explicit fact the caller supplies (assigned, commented on by
 * a Member); an External Link, Linked or Broken, also counts as triage, since
 * a Member made it. An Issue archived forever as spam, or one being deleted or
 * merged away, keeps the status last shown, so `lastShown` is an input; at
 * filing it is `received`. Two Reports on one Issue get the same status
 * whatever each showed before, except under spam.
 */

import type { ReleaseFirstSeen } from '../release/ordering.js';
import type { Resolution } from '../issue/resolution.js';
import type { IssueState } from '../issue/state.js';

export const REPORT_STATUSES = ['received', 'acknowledged', 'fixed', 'released', 'closed'] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** The tie between an Issue and a GitHub issue, in its place in State Machine: External Link. */
export type ExternalLink = { readonly state: 'linked' | 'broken' };

/** Whether a Member has triaged an Issue by hand, other than by linking it externally. */
export type IssueTriage = {
  readonly assigned: boolean;
  readonly commentedByMember: boolean;
};

export type ReportStatusFacts = {
  readonly triage: IssueTriage;
  /** Releases seen in the Organization, so a Resolution's release can be known to have shipped. */
  readonly releasesSeen: ReleaseFirstSeen;
  /** The Report Status the Reporter was last shown. */
  readonly lastShown: ReportStatus;
};

// --- predicates ---

function isTriaged(triage: IssueTriage, externalLink: ExternalLink | null): boolean {
  return triage.assigned || triage.commentedByMember || externalLink !== null;
}

function isReleaseSeen(resolution: Resolution, releasesSeen: ReleaseFirstSeen): boolean {
  return resolution.kind !== 'plain' && resolution.release !== null && releasesSeen.has(resolution.release);
}

// --- exports ---

/** The Report Status of every Report attached to `issue`. */
export function reportStatusOf(issue: IssueState, externalLink: ExternalLink | null, facts: ReportStatusFacts): ReportStatus {
  switch (issue.status) {
    case 'unresolved':
      return issue.substatus === 'new' && !isTriaged(facts.triage, externalLink) ? 'received' : 'acknowledged';
    case 'resolved':
      return isReleaseSeen(issue.resolution, facts.releasesSeen) ? 'released' : 'fixed';
    case 'archived':
      if (issue.substatus !== 'forever') return 'acknowledged';
      return issue.spam ? facts.lastShown : 'closed';
    default:
      return facts.lastShown;
  }
}
