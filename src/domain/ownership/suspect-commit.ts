/**
 * Suspect Commit -- the commit most likely to have caused an Issue (design
 * Code and GitHub, Suspect commit; Domain Language: Suspect Commit, Suspect
 * Commit Window). It is the commit that last changed the line of the
 * topmost in-app frame: the innermost in-app frame that names a path and a
 * line. A blame divides a file into line ranges, each last changed by one
 * commit. A commit is named only when it falls inside the Suspect Commit
 * Window before the Issue was first seen; a later commit cannot have caused
 * it. Times are epoch milliseconds.
 */

import type { Repository } from '../tracker/external-link.js';
import type { OwnershipFacts, OwnershipFrame } from './facts.js';

/** A commit as a blame names it: its hash, its author's address or login (either may be unknown), and when it was made. */
export type BlamedCommit = {
  readonly hash: string;
  readonly author: { readonly email: string | null; readonly login: string | null };
  readonly at: number;
};

/** Lines `startingLine` to `endingLine` (inclusive, from 1), last changed by `commit`. */
export type BlameRange = { readonly startingLine: number; readonly endingLine: number; readonly commit: BlamedCommit };

export type SuspectCommit = {
  readonly repository: Repository;
  readonly path: string;
  readonly line: number;
  readonly commit: BlamedCommit;
};

/** A frame known to name a path and a line. */
export type LocatedFrame = OwnershipFrame & { readonly path: string; readonly lineno: number };

// --- predicates ---

function isLocatedInApp(frame: OwnershipFrame): frame is LocatedFrame {
  return frame.inApp && frame.path !== null && frame.lineno !== null;
}

/** Whether the commit was made inside the window ending when the Issue was first seen. */
export function isWithinWindow(commit: BlamedCommit, bound: { readonly firstSeen: number; readonly window: number }): boolean {
  return commit.at <= bound.firstSeen && commit.at >= bound.firstSeen - bound.window;
}

// --- exports ---

/** The innermost in-app frame naming a path and a line; frames run oldest call first. */
export function topInAppFrame(facts: OwnershipFacts): LocatedFrame | null {
  return facts.frames.findLast(isLocatedInApp) ?? null;
}

/** The commit whose blame range holds the line, or null when none does. */
export function commitOfLine(ranges: readonly BlameRange[], line: number): BlamedCommit | null {
  return ranges.find((range) => range.startingLine <= line && line <= range.endingLine)?.commit ?? null;
}
