/**
 * Tracker -- the seam for an issue tracker (architecture Seams: Issue
 * tracker). The GitHub App adapter in production, an in-memory fake in tests;
 * Jira is the second mechanism. Names are provider-neutral: a tracker issue
 * lives in a Repository and has a number there.
 *
 * Every call returns a Refusal instead of throwing when the tracker refuses
 * or cannot be reached, so a caller can count it toward the External Link
 * becoming Broken.
 */

import type { Refusal } from '../domain/refusal.js';
import type { CloseReason, Repository, TrackerState } from '../domain/tracker/external-link.js';

/** One tracker issue: its Repository and its number there. */
export type TrackerIssueRef = { readonly repository: Repository; readonly number: number };

/** What opening a tracker issue sends; the body comes from the outbound template. */
export type TrackerIssueDraft = {
  readonly repository: Repository;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
};

export interface Tracker {
  openIssue(draft: TrackerIssueDraft): Promise<{ readonly number: number } | Refusal>;
  /** Closes the issue for the reason given; returns the state the tracker now holds. */
  closeIssue(close: TrackerIssueRef & { readonly reason: CloseReason }): Promise<TrackerState | Refusal>;
  /** Reopens the issue; returns the state the tracker now holds. */
  reopenIssue(issue: TrackerIssueRef): Promise<TrackerState | Refusal>;
  postComment(comment: TrackerIssueRef & { readonly body: string }): Promise<{ readonly id: number } | Refusal>;
  /** The issue's current state. */
  getIssue(issue: TrackerIssueRef): Promise<TrackerState | Refusal>;
}
