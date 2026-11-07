/**
 * Thread and Follow-up View -- the conversation on one Report and what its
 * Follow-up Page shows (design Reports, Thread and Follow-up Page; Domain
 * Language: Comment, Thread, Follow-up View).
 *
 * Comments live on the Issue. A Member's Comment is shared or private; a
 * reporter's is always shared and names the Report it was written on. A
 * Report's Thread holds the Issue's shared Member Comments and the replies
 * written on that Report only, so Reports moved onto one Issue never see
 * each other's replies. The Follow-up View names authors only as `team` or
 * `you` (the Report's Reporter) and holds nothing else about the Issue.
 */

import { change, type Actor, type IssueChange, type IssueState } from '../issue/state.js';
import type { Report } from './report.js';
import type { IssueTriage, ReportStatus } from './status.js';

/** A Comment by a Member, shared with the Reporter or kept private. */
export type MemberComment = {
  readonly id: string;
  readonly author: { readonly member: string };
  readonly shared: boolean;
  readonly text: string;
  readonly at: number;
};

/** A Comment by a Reporter, written on the named Report; always shared. */
export type ReporterComment = {
  readonly id: string;
  readonly author: { readonly report: string };
  readonly shared: true;
  readonly text: string;
  readonly at: number;
};

export type Comment = MemberComment | ReporterComment;

/** The Comments that enter one Report's conversation, oldest first. */
export type Thread = readonly Comment[];

/** One change of the Report Status the Reporter was shown, and when. */
export type ReportStatusChange = { readonly status: ReportStatus; readonly at: number };

export type FollowUpEntry = { readonly author: 'team' | 'you'; readonly text: string; readonly at: number };

/** What the Follow-up Page shows: Report Status, shared Thread and dates only. */
export type FollowUpView = {
  readonly status: ReportStatus;
  readonly thread: readonly FollowUpEntry[];
  readonly changes: readonly ReportStatusChange[];
};

// --- predicates ---

export function isShared(comment: Comment): boolean {
  return comment.shared;
}

function isMemberComment(comment: Comment): comment is MemberComment {
  return 'member' in comment.author;
}

function entersThread(report: Report, comment: Comment): boolean {
  if (isMemberComment(comment)) return comment.shared;
  return comment.author.report === report.id;
}

// --- helpers ---

function entryOf(comment: Comment): FollowUpEntry {
  return { author: isMemberComment(comment) ? 'team' : 'you', text: comment.text, at: comment.at };
}

// --- exports ---

/**
 * Whether a Member triaged the Issue by commenting. Only a shared Comment
 * counts: a private note must leave the Reporter told nothing (design
 * Behaviors: Private comment stays private). Assignment is not modelled on
 * the Issue yet, so it never counts.
 */
export function triageOf(comments: readonly Comment[]): IssueTriage {
  return { assigned: false, commentedByMember: comments.some((comment) => isMemberComment(comment) && comment.shared) };
}

/** The Report Status the Reporter was last shown: the latest change, or Received before any. */
export function lastShownStatus(changes: readonly ReportStatusChange[]): ReportStatus {
  const latest = changes.reduce<ReportStatusChange | null>((last, entry) => (last === null || entry.at >= last.at ? entry : last), null);
  return latest?.status ?? 'received';
}

/** The Issue Change recording a saved Comment: it names the Comment, never its text. */
export function commentRecorded(state: IssueState, comment: Comment, actor: Actor): IssueChange {
  return change(state, { kind: 'comment', from: null, to: comment.id, actor, at: comment.at });
}

/** The Thread of `report`, from the Comments on its Issue. */
export function threadOf(report: Report, comments: readonly Comment[]): Thread {
  return comments.filter((comment) => entersThread(report, comment)).sort((a, b) => a.at - b.at);
}

/** The Follow-up View of `report`: its Report Status, its Thread and the dates its status changed. */
export function followUpView(input: {
  report: Report;
  status: ReportStatus;
  changes: readonly ReportStatusChange[];
  comments: readonly Comment[];
}): FollowUpView {
  return {
    status: input.status,
    thread: threadOf(input.report, input.comments).map(entryOf),
    changes: input.changes.map((entry) => ({ status: entry.status, at: entry.at })),
  };
}
