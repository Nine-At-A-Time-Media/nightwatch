/**
 * Outcome -- the recorded fate of an Arrival or one of its items (design
 * Domain Language). Every item ends in exactly one Outcome (G17).
 *
 * An item admission retains is named by its Outcome Item: its Arrival Record
 * and its index among that record's items. Processing names the same item
 * when it decides a later fate for it, or the whole record (index null) when
 * it refuses the record without reading its items, so the totals count each
 * item once, by its final Outcome. An Outcome decided before any record
 * exists (refused, filtered or rate limited at admission), and a rolled-up
 * row, names no item.
 */

import type { DataCategory } from '../protocol/retry-advice.js';

export type OutcomeKind = 'accepted' | 'filtered' | 'rate_limited' | 'invalid' | 'discarded';

/** Categories of data the design's Non-Goals defer; counted, never processed. */
export type OutOfScopeCategory = 'transaction' | 'span' | 'replay' | 'profile' | 'metric' | 'client_report';

export type OutcomeCategory = DataCategory | OutOfScopeCategory;

/** The item an Outcome is about: its Arrival Record and its index there; a null index stands for every item of the record. */
export type OutcomeItem = { readonly recordId: string; readonly index: number | null };

export type Outcome = {
  readonly projectId: string;
  readonly recordedAt: number;
  readonly kind: OutcomeKind;
  readonly reason: string | null;
  readonly category: OutcomeCategory;
  readonly quantity: number;
  /** The retained item this Outcome is about; absent when it is about none. */
  readonly item?: OutcomeItem;
};
