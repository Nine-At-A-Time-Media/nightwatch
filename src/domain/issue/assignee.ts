/**
 * Assignee -- giving an Issue its one Member or Team responsible (design
 * Issues, Assignment: at most one Assignee; Domain Language: Assignee).
 *
 * A change of Assignee is recorded in the Issue's History as an `assignee`
 * change naming the Assignee before and after (`member:<id>`, `team:<name>`,
 * or none). A Member's assignment is a triage action, so it also takes the
 * Issue out of For Review (design Issues, Inbox); an assignment Nightwatch
 * makes itself, as when a Project auto-assigns a suggested owner, leaves For
 * Review as it was. Assigning the Assignee the Issue already has records no
 * `assignee` change.
 */

import type { Assignee } from '../alerts/issue-alert-rule.js';
import type { Refusal } from '../refusal.js';
import { chain, change, goneRefusal, leaveForReview, unchanged, type Actor, type IssueState, type IssueTransition } from './state.js';

/** One change of an Issue's Assignee; `null` is none. */
export type AssigneeChange = {
  readonly from: Assignee | null;
  readonly to: Assignee | null;
  readonly actor: Actor;
  readonly at: number;
};

// --- predicates ---

function isMemberActor(actor: Actor): boolean {
  return typeof actor === 'object';
}

function isSameAssignee(a: Assignee | null, b: Assignee | null): boolean {
  if (a === null || b === null) return a === b;
  if ('member' in a) return 'member' in b && a.member === b.member;
  return 'team' in b && a.team === b.team;
}

// --- helpers ---

function labelOf(assignee: Assignee | null): string | null {
  return assignee === null ? null : assigneeLabel(assignee);
}

function recordAssignee(state: IssueState, entry: AssigneeChange): IssueTransition {
  if (isSameAssignee(entry.from, entry.to)) return unchanged(state);
  const { actor, at } = entry;
  return { state, changes: [change(state, { kind: 'assignee', from: labelOf(entry.from), to: labelOf(entry.to), actor, at })] };
}

// --- exports ---

/** The History label of an Assignee: `member:<id>` or `team:<name>`. */
export function assigneeLabel(assignee: Assignee): string {
  return 'member' in assignee ? `member:${assignee.member}` : `team:${assignee.team}`;
}

export function assign(state: IssueState, entry: AssigneeChange): IssueTransition | Refusal {
  const gone = goneRefusal(state);
  if (gone) return gone;
  const recorded = recordAssignee(state, entry);
  return isMemberActor(entry.actor) ? chain(recorded, (s) => leaveForReview(s, entry.actor, entry.at)) : recorded;
}
