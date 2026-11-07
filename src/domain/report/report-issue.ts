/**
 * Report issue -- an Issue created to hold a new Report (design Reports,
 * Attachment; Domain Language: Report issue). It opens Unresolved/New in For
 * Review like any new Issue, but counts no Event and holds no Fingerprint
 * until merged with a crash Issue. An Issue left with neither a Report nor a
 * Fingerprint breaks the Issue invariant and is removed by its caller.
 */

import type { IssueId } from '../ids.js';
import { chain, change, enterForReview, type IssueState, type IssueTransition } from '../issue/state.js';

/** A Report carries no event level; its Issue starts at medium Priority. */
const REPORT_ISSUE_PRIORITY = { level: 'medium', setByHand: false } as const;

// --- predicates ---

/** True when an Issue holds neither a Report nor a Fingerprint. */
export function isEmptyReportIssue(held: { reports: number; fingerprints: number }): boolean {
  return held.reports === 0 && held.fingerprints === 0;
}

// --- exports ---

/** The Report issue a new Report starts on: Unresolved/New, in For Review, with no Event counted. */
export function createReportIssue(first: { issueId: IssueId; at: number }): IssueTransition {
  const state: IssueState = {
    issueId: first.issueId,
    substatusSince: first.at,
    firstSeen: first.at,
    lastSeen: first.at,
    count: 0,
    userCount: 0,
    priority: REPORT_ISSUE_PRIORITY,
    forReviewSince: null,
    status: 'unresolved',
    substatus: 'new',
  };
  const opened = { state, changes: [change(state, { kind: 'status', from: null, to: 'unresolved/new', actor: 'system', at: first.at })] };
  return chain(opened, (s) => enterForReview(s, first.at));
}
