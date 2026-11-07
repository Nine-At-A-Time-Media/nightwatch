/**
 * Quota rules at admission -- what to ask the QuotaGate for, how its denials
 * close items, and the Retry advice ceiling (design: Ingest, Limits).
 */

import type { DataCategory, RetryAdviceEntry } from '../protocol/retry-advice.js';
import { isOpen, type ItemFate } from './items.js';

export type CategoryQuantity = { readonly category: DataCategory; readonly quantity: number };

const DEFAULT_REASON = 'quota-exceeded';

/** How many open items each category holds, in first-seen order. */
export function openQuantities(fates: readonly ItemFate[]): CategoryQuantity[] {
  const counts = new Map<DataCategory, number>();
  for (const fate of fates.filter(isOpen)) counts.set(fate.category, (counts.get(fate.category) ?? 0) + 1);
  return Array.from(counts, ([category, quantity]) => ({ category, quantity }));
}

/** Rate limit every open item whose category the QuotaGate denied. */
export function applyQuotaDenials({
  fates,
  denials,
}: {
  fates: readonly ItemFate[];
  denials: ReadonlyMap<DataCategory, RetryAdviceEntry>;
}): ItemFate[] {
  return fates.map((fate) => {
    const denial = isOpen(fate) ? denials.get(fate.category) : undefined;
    return denial ? { ...fate, verdict: { kind: 'rate_limited', reason: denial.reason ?? DEFAULT_REASON } } : fate;
  });
}

/** Retry Advice never asks a sender to wait past the Retry advice ceiling. */
export function capRetryAdvice({ entry, ceilingSeconds }: { entry: RetryAdviceEntry; ceilingSeconds: number }): RetryAdviceEntry {
  return { ...entry, retryAfterSeconds: Math.min(entry.retryAfterSeconds, ceilingSeconds) };
}
