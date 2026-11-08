/**
 * Owner Suggestion -- who should own an Issue, and why (design G13; Issues,
 * Ownership; Code and GitHub, Suspect commit and CODEOWNERS). Owners are
 * ranked by where they came from: the matching Ownership Rule first, since
 * rules outrank CODEOWNERS, then the CODEOWNERS owners, then the Suspect
 * Commit's author. An owner named twice keeps the higher place. A Project
 * that auto-assigns gives the first owner to an Issue with no Assignee.
 */

import type { Assignee } from '../alerts/issue-alert-rule.js';
import type { IssueId } from '../ids.js';
import type { SuspectCommit } from './suspect-commit.js';

export type OwnerSource = 'ownership_rule' | 'codeowners' | 'suspect_commit';

export type SuggestedOwner = { readonly owner: Assignee; readonly source: OwnerSource };

export type OwnerSuggestion = {
  readonly issueId: IssueId;
  readonly owners: readonly SuggestedOwner[];
  readonly suspectCommit: SuspectCommit | null;
  /** The Assignee auto-assignment gave the Issue; null when it gave none. */
  readonly assigned: Assignee | null;
};

const RANK: Readonly<Record<OwnerSource, number>> = { ownership_rule: 0, codeowners: 1, suspect_commit: 2 };

// --- predicates ---

function isSameOwner(a: Assignee, b: Assignee): boolean {
  if ('member' in a) return 'member' in b && a.member === b.member;
  return 'team' in b && a.team === b.team;
}

// --- exports ---

/** The owners in rank order, each named once at its highest place. */
export function rankedOwners(candidates: readonly SuggestedOwner[]): readonly SuggestedOwner[] {
  const ordered = [...candidates].sort((a, b) => RANK[a.source] - RANK[b.source]);
  return ordered.filter((candidate, index) => ordered.findIndex((held) => isSameOwner(held.owner, candidate.owner)) === index);
}

/** The Assignee auto-assignment gives: the first owner, when the Project auto-assigns and the Issue has none. */
export function autoAssignee(owners: readonly SuggestedOwner[], state: { autoAssign: boolean; current: Assignee | null }): Assignee | null {
  if (!state.autoAssign || state.current !== null) return null;
  return owners[0]?.owner ?? null;
}
