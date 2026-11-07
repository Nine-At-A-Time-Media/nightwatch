/**
 * Time Range -- a span of time an operator names, for reprocessing raw
 * arrivals or viewing Outcome totals (design Reprocessing, Behaviors:
 * Outcome totals; architecture Use-case surface: `TimeRange`). Epoch
 * milliseconds, half-open: it holds its start and not its end, so adjacent
 * ranges never share a moment.
 */

export type TimeRange = { readonly start: number; readonly end: number };

// --- predicates ---

export function isWithinRange(at: number, range: TimeRange): boolean {
  return at >= range.start && at < range.end;
}
