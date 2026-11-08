/**
 * Erasure -- the result of erasing a reporter's Reports and contact details
 * (design Retention and data handling, Erasure; Behaviors: Erasure reaches
 * every store). It names how many Reports were erased and every store that
 * could not be erased, so the owner is told when the erasure is incomplete.
 */

export type Erasure = {
  readonly reports: number;
  readonly complete: boolean;
  /** The stores that could not be erased, sorted; empty when complete. */
  readonly incomplete: readonly string[];
};

// --- exports ---

export function erasureOf(result: { reports: number; failed: readonly string[] }): Erasure {
  const incomplete = [...new Set(result.failed)].sort();
  return { reports: result.reports, complete: incomplete.length === 0, incomplete };
}
