/**
 * Outcome totals -- a Project's Outcomes over a Time Range, summed per kind
 * and reason (design Behaviors: Outcome totals; Operator). Built from the
 * archived Outcomes an ArchiveQuery answers; quantities add, so a roll-up
 * row and the rows it rolls up give the same totals.
 *
 * Each item counts once, by its final Outcome (G17). Admission archives an
 * accepted Outcome naming each item it retains; processing archives a
 * further Outcome naming the same item when it refuses, drops or defers it,
 * or naming the whole record when it refuses the record unread. So, per
 * Arrival Record: a record-wide Outcome stands in for every item of the
 * record; otherwise each item counts under a refusal processing decided,
 * else under its acceptance. A redelivered record's repeated refusal counts
 * once. Where one item holds several refusals, the first in the totals'
 * order counts, so the answer never depends on archive order. An Outcome
 * naming no item counts as it is.
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

function isRecordWide(outcome: Outcome): boolean {
  return outcome.item?.index === null;
}

function isRefused(outcome: Outcome): boolean {
  return outcome.kind !== 'accepted';
}

// --- helpers ---

function totalKey(outcome: { kind: OutcomeKind; reason: string | null }): string {
  return JSON.stringify([outcome.kind, outcome.reason]);
}

/** Kinds in KIND_ORDER, then reasons with none first and the rest by text. */
function compareTotals(a: { kind: OutcomeKind; reason: string | null }, b: { kind: OutcomeKind; reason: string | null }): number {
  const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  if (byKind !== 0) return byKind;
  if (a.reason === b.reason) return 0;
  if (a.reason === null) return -1;
  if (b.reason === null) return 1;
  return a.reason < b.reason ? -1 : 1;
}

function groupBy(outcomes: readonly Outcome[], keyOf: (outcome: Outcome) => string): Map<string, Outcome[]> {
  const groups = new Map<string, Outcome[]>();
  for (const outcome of outcomes) groups.set(keyOf(outcome), [...(groups.get(keyOf(outcome)) ?? []), outcome]);
  return groups;
}

/** The final Outcome among those naming one item: a refusal over an acceptance, then the first in the totals' order. */
function finalOf(outcomes: readonly Outcome[]): readonly Outcome[] {
  const refusals = outcomes.filter(isRefused);
  const [first] = [...(refusals.length > 0 ? refusals : outcomes)].sort(compareTotals);
  return first === undefined ? [] : [first];
}

/** The Outcomes one Arrival Record's items count under: a record-wide one in place of all, else each item's final Outcome. */
function recordFinals(outcomes: readonly Outcome[]): readonly Outcome[] {
  const wide = outcomes.filter(isRecordWide);
  if (wide.length > 0) return finalOf(wide);
  return [...groupBy(outcomes, (outcome) => String(outcome.item?.index)).values()].flatMap(finalOf);
}

/** Each Outcome that counts: those naming no item as they are, and one final Outcome per named item. */
function countedOutcomes(outcomes: readonly Outcome[]): readonly Outcome[] {
  const unnamed = outcomes.filter((outcome) => outcome.item === undefined);
  const named = outcomes.filter((outcome) => outcome.item !== undefined);
  const records = groupBy(named, (outcome) => outcome.item?.recordId ?? '');
  return [...unnamed, ...[...records.values()].flatMap(recordFinals)];
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
  for (const outcome of countedOutcomes(outcomes.filter((held) => isCounted(held, { projectId, range })))) {
    const key = totalKey(outcome);
    const quantity = (sums.get(key)?.quantity ?? 0) + outcome.quantity;
    sums.set(key, { kind: outcome.kind, reason: outcome.reason, quantity });
  }
  return { projectId, range, totals: [...sums.values()].sort(compareTotals) };
}
