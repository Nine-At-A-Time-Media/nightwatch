/**
 * Arrival items -- reading an Arrival as items, classifying each item kind,
 * and deciding each item's fate before the Arrival is made durable. An item
 * whose fate is still open (`verdict: null`) is a candidate for acceptance.
 */

import type { Outcome, OutcomeCategory, OutcomeKind, OutOfScopeCategory } from '../outcome/outcome.js';
import { parseEnvelope, type Envelope, type EnvelopeItem } from '../protocol/envelope.js';
import type { DataCategory } from '../protocol/retry-advice.js';
import type { Refusal } from '../refusal.js';
import type { Arrival, EndpointKind } from './arrival.js';

export type ItemClass =
  | { readonly scope: 'in'; readonly category: DataCategory }
  | { readonly scope: 'out'; readonly category: OutOfScopeCategory }
  | { readonly scope: 'unknown' };

export type Verdict = { readonly kind: OutcomeKind; readonly reason: string | null };

export type OpenItem = { readonly item: EnvelopeItem; readonly category: DataCategory; readonly verdict: null };
export type DecidedItem = { readonly item: EnvelopeItem; readonly category: OutcomeCategory; readonly verdict: Verdict };
export type ItemFate = OpenItem | DecidedItem;

const IN_SCOPE = new Map<string, DataCategory>([
  ['event', 'error'],
  ['attachment', 'attachment'],
  ['session', 'session'],
  ['sessions', 'session'],
  ['feedback', 'feedback'],
  ['user_report', 'feedback'],
  ['check_in', 'monitor'],
  ['security', 'security'],
]);

const ENDPOINT_ITEM: Readonly<Record<Exclude<EndpointKind, 'envelope'>, string>> = {
  store: 'event',
  security: 'security',
  attachment: 'attachment',
  checkin: 'check_in',
};

// --- predicates ---

export function isOpen(fate: ItemFate): fate is OpenItem {
  return fate.verdict === null;
}

// --- helpers ---

export function classifyItem(type: string): ItemClass {
  const inScope = IN_SCOPE.get(type);
  if (inScope) return { scope: 'in', category: inScope };
  return { scope: 'unknown' };
}

/** The Arrival as an envelope; an endpoint other than envelope carries one item of its own kind. */
export function arrivalEnvelope(arrival: Arrival): Envelope | Refusal {
  if (arrival.endpoint === 'envelope') return parseEnvelope(arrival.body);
  return { header: {}, items: [{ header: { type: ENDPOINT_ITEM[arrival.endpoint] }, payload: arrival.body }] };
}

function triageItem(item: EnvelopeItem): ItemFate {
  const kind = classifyItem(item.header.type);
  if (kind.scope === 'in') return { item, category: kind.category, verdict: null };
  if (kind.scope === 'out') return { item, category: kind.category, verdict: { kind: 'discarded', reason: 'out-of-scope' } };
  return { item, category: 'default', verdict: { kind: 'discarded', reason: 'unknown-item-kind' } };
}

/** Each item's fate before quotas and durability. */
export function triageItems(envelope: Envelope): ItemFate[] {
  return envelope.items.map(triageItem);
}

/** Close every open item with the given verdict. */
export function settleOpenItems({ fates, verdict }: { fates: readonly ItemFate[]; verdict: Verdict }): DecidedItem[] {
  return fates.map((fate) => (isOpen(fate) ? { ...fate, verdict } : fate));
}

export function itemOutcomes({
  fates,
  projectId,
  recordedAt,
}: {
  fates: readonly DecidedItem[];
  projectId: string;
  recordedAt: number;
}): Outcome[] {
  return fates.map((fate) => ({ projectId, recordedAt, ...fate.verdict, category: fate.category, quantity: 1 }));
}
