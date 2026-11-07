/**
 * Outcome totals -- a Project's Outcomes over a Time Range, summed per kind
 * and reason (design Behaviors: Outcome totals; Operator). Built from the
 * archived Outcomes an ArchiveQuery answers; quantities add, so a roll-up
 * row and the rows it rolls up give the same totals.
 *
 * Totals count what was archived. Admission archives one Outcome per item;
 * processing archives a further Outcome for an item it refuses, drops or
 * defers, and an archived Outcome names no item, so such an item is counted
 * under both its admission Outcome and its processing Outcome.
 */

import type { ProjectId } from '../ids.js';
import { isWithinRange, type TimeRange } from '../time-range.js';
import type { Outcome, OutcomeKind } from './outcome.js';

/** The quantity of one kind and reason. */
export type OutcomeTotal = { readonly kind: OutcomeKind; readonly reason: string | null; readonly quantity: number };

export type OutcomeTotals = { readonly projectId: ProjectId; readonly range: TimeRange; readonly totals: readonly OutcomeTotal[] };

/** The order kinds are shown in: an Arrival's path from accepted to discarded. */
const KIND_ORDER: readonly OutcomeKind[] = ['accepted', 'filtered', 'rate_limited', 'invalid', 'discarded'];

// --- predicates ---

function isCounted(outcome: Outcome, scope: { projectId: ProjectId; range: TimeRange }): boolean {
  return outcome.projectId === scope.projectId && isWithinRange(outcome.recordedAt, scope.range);
}

// --- helpers ---

function totalKey(outcome: { kind: OutcomeKind; reason: string | null }): string {
  return JSON.stringify([outcome.kind, outcome.reason]);
}

/** Kinds in KIND_ORDER, then reasons with none first and the rest by text. */
function compareTotals(a: OutcomeTotal, b: OutcomeTotal): number {
  const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  if (byKind !== 0) return byKind;
  if (a.reason === b.reason) return 0;
  if (a.reason === null) return -1;
  if (b.reason === null) return 1;
  return a.reason < b.reason ? -1 : 1;
}

// --- exports ---

export function outcomeTotalsOf({
  projectId,
  range,
  outcomes,
}: {
  projectId: ProjectId;
  range: TimeRange;
  outcomes: readonly Outcome[];
}): OutcomeTotals {
  const sums = new Map<string, OutcomeTotal>();
  for (const outcome of outcomes.filter((held) => isCounted(held, { projectId, range }))) {
    const key = totalKey(outcome);
    const quantity = (sums.get(key)?.quantity ?? 0) + outcome.quantity;
    sums.set(key, { kind: outcome.kind, reason: outcome.reason, quantity });
  }
  return { projectId, range, totals: [...sums.values()].sort(compareTotals) };
}
