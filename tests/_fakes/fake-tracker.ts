/**
 * FakeTracker -- an in-memory Tracker. It keeps each tracker issue's state
 * and comments, numbering issues from 1 per Repository, and records every
 * call in order for assertions. `refusing` makes every call refuse with it,
 * as the tracker would when it denies a write or cannot be reached.
 */

import { refusal, type Refusal } from '../../src/domain/refusal.js';
import type { CloseReason, Repository, TrackerState } from '../../src/domain/tracker/external-link.js';
import type { Tracker, TrackerIssueDraft, TrackerIssueRef } from '../../src/ports/tracker.js';

export type TrackerCall =
  | { readonly kind: 'openIssue'; readonly draft: TrackerIssueDraft }
  | { readonly kind: 'closeIssue'; readonly issue: TrackerIssueRef; readonly reason: CloseReason }
  | { readonly kind: 'reopenIssue'; readonly issue: TrackerIssueRef }
  | { readonly kind: 'postComment'; readonly issue: TrackerIssueRef; readonly body: string }
  | { readonly kind: 'getIssue'; readonly issue: TrackerIssueRef };

type Held = { state: TrackerState; readonly draft: TrackerIssueDraft; readonly comments: string[] };

const NOT_FOUND = refusal('tracker_not_found');

export class FakeTracker implements Tracker {
  readonly calls: TrackerCall[] = [];
  refusing: Refusal | null = null;
  readonly #issues = new Map<string, Held>();
  readonly #counters = new Map<Repository, number>();

  /** A tracker issue as it stands, or undefined. */
  issue(ref: TrackerIssueRef): { state: TrackerState; draft: TrackerIssueDraft; comments: readonly string[] } | undefined {
    return this.#issues.get(keyOf(ref));
  }

  /** Changes a tracker issue's state as a person on the tracker would, recording no call. */
  setState(ref: TrackerIssueRef, state: TrackerState): void {
    const held = this.#issues.get(keyOf(ref));
    if (held) held.state = state;
  }

  async openIssue(draft: TrackerIssueDraft): Promise<{ readonly number: number } | Refusal> {
    this.calls.push({ kind: 'openIssue', draft });
    if (this.refusing) return this.refusing;
    const number = (this.#counters.get(draft.repository) ?? 0) + 1;
    this.#counters.set(draft.repository, number);
    this.#issues.set(keyOf({ repository: draft.repository, number }), { state: { state: 'open' }, draft, comments: [] });
    return { number };
  }

  async closeIssue(close: TrackerIssueRef & { readonly reason: CloseReason }): Promise<TrackerState | Refusal> {
    const issue = { repository: close.repository, number: close.number };
    this.calls.push({ kind: 'closeIssue', issue, reason: close.reason });
    return this.#write(issue, { state: 'closed', reason: close.reason });
  }

  async reopenIssue(issue: TrackerIssueRef): Promise<TrackerState | Refusal> {
    this.calls.push({ kind: 'reopenIssue', issue });
    return this.#write(issue, { state: 'open' });
  }

  async postComment(comment: TrackerIssueRef & { readonly body: string }): Promise<{ readonly id: number } | Refusal> {
    const issue = { repository: comment.repository, number: comment.number };
    this.calls.push({ kind: 'postComment', issue, body: comment.body });
    if (this.refusing) return this.refusing;
    const held = this.#issues.get(keyOf(issue));
    if (!held) return NOT_FOUND;
    held.comments.push(comment.body);
    return { id: held.comments.length };
  }

  async getIssue(issue: TrackerIssueRef): Promise<TrackerState | Refusal> {
    this.calls.push({ kind: 'getIssue', issue });
    if (this.refusing) return this.refusing;
    return this.#issues.get(keyOf(issue))?.state ?? NOT_FOUND;
  }

  #write(issue: TrackerIssueRef, state: TrackerState): TrackerState | Refusal {
    if (this.refusing) return this.refusing;
    const held = this.#issues.get(keyOf(issue));
    if (!held) return NOT_FOUND;
    held.state = state;
    return state;
  }
}

function keyOf(ref: TrackerIssueRef): string {
  return `${ref.repository}#${ref.number}`;
}
