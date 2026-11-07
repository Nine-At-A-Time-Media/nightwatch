/**
 * Assignment and Tombstone (design Domain Language; Grouping, Assignment and
 * Tombstones). An Assignment names the Issue an Event joined, or the
 * Tombstone that dropped it, with the Issue Changes it caused. A duplicate
 * Assignment repeats the earlier target of the same Event and changes
 * nothing. A Tombstone is identified by the Issue that was discarded.
 */

import type { Fingerprint } from '../grouping/fingerprint.js';
import type { IssueId } from '../ids.js';
import type { Actor, IssueChange } from './state.js';

export type Tombstone = {
  /** The discarded Issue. */
  readonly issueId: IssueId;
  readonly fingerprints: readonly Fingerprint[];
  readonly at: number;
  readonly actor: Actor;
};

export type AssignmentTarget = { readonly issueId: IssueId } | { readonly tombstone: IssueId };

export type Assignment = AssignmentTarget & { readonly changes: readonly IssueChange[]; readonly duplicate: boolean };

// --- exports ---

export function joined(issueId: IssueId, changes: readonly IssueChange[]): Assignment {
  return { issueId, changes, duplicate: false };
}

export function dropped(tombstone: Tombstone): Assignment {
  return { tombstone: tombstone.issueId, changes: [], duplicate: false };
}

/** The Assignment of an Event already processed: the same target, nothing changed. */
export function duplicateOf(target: AssignmentTarget): Assignment {
  return { ...target, changes: [], duplicate: true };
}

export function targetOf(assignment: Assignment): AssignmentTarget {
  return 'issueId' in assignment ? { issueId: assignment.issueId } : { tombstone: assignment.tombstone };
}
