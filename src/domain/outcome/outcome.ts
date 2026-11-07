/**
 * Outcome -- the recorded fate of an Arrival or one of its items (design
 * Domain Language). Every item ends in exactly one Outcome (G17).
 */

import type { DataCategory } from '../protocol/retry-advice.js';

export type OutcomeKind = 'accepted' | 'filtered' | 'rate_limited' | 'invalid' | 'discarded';

/** Categories of data the design's Non-Goals defer; counted, never processed. */
export type OutOfScopeCategory = 'transaction' | 'span' | 'replay' | 'profile' | 'metric' | 'client_report';

export type OutcomeCategory = DataCategory | OutOfScopeCategory;

export type Outcome = {
  readonly projectId: string;
  readonly recordedAt: number;
  readonly kind: OutcomeKind;
  readonly reason: string | null;
  readonly category: OutcomeCategory;
  readonly quantity: number;
};
