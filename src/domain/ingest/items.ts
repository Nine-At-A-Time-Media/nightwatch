/**
 * Arrival items -- reading an Arrival as items, classifying each item kind,
 * and deciding each item's fate before the Arrival is made durable. An item
 * whose fate is still open (`verdict: null`) is a candidate for acceptance.
 */

import type { Outcome, OutcomeCategory, OutcomeKind, OutOfScopeCategory } from '../outcome/outcome.js';
import { parseEnvelope, serializeEnvelope, type Envelope, type EnvelopeItem } from '../protocol/envelope.js';
import type { DataCategory } from '../protocol/retry-advice.js';
import type { Refusal } from '../refusal.js';
import type { Arrival, EndpointKind, SizeLimits } from './arrival.js';

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

export function isOversizeArrival({ arrival, limits }: { arrival: Arrival; limits: SizeLimits }): boolean {
  return arrival.body.length > limits.arrival;
}

function isOversizeItem({ item, limits }: { item: EnvelopeItem; limits: SizeLimits }): boolean {
  return item.payload.length > (item.header.type === 'attachment' ? limits.attachment : limits.event);
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

function triageItem({ item, limits }: { item: EnvelopeItem; limits: SizeLimits }): ItemFate {
  const kind = classifyItem(item.header.type);
  if (kind.scope === 'in' && isOversizeItem({ item, limits })) {
    return { item, category: kind.category, verdict: { kind: 'invalid', reason: 'too-large' } };
  }
  if (kind.scope === 'in') return { item, category: kind.category, verdict: null };
  if (kind.scope === 'out') return { item, category: kind.category, verdict: { kind: 'discarded', reason: 'out-of-scope' } };
  return { item, category: 'default', verdict: { kind: 'discarded', reason: 'unknown-item-kind' } };
}

/** Each item's fate before quotas and durability. */
export function triageItems({ envelope, limits }: { envelope: Envelope; limits: SizeLimits }): ItemFate[] {
  return envelope.items.map((item) => triageItem({ item, limits }));
}

/** The body to retain: as received when every item is kept, else the envelope header and the kept items. */
export function keptBody({ arrival, envelope, fates }: { arrival: Arrival; envelope: Envelope; fates: readonly ItemFate[] }): Uint8Array {
  if (arrival.endpoint !== 'envelope' || fates.every(isOpen)) return arrival.body;
  return serializeEnvelope({ header: envelope.header, items: fates.filter(isOpen).map((fate) => fate.item) });
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
