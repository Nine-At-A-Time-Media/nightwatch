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
import { matchingInboundFilter, type InboundFilterConfig } from './inbound-filters.js';

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

/** Item kinds of products the design's Non-Goals defer: counted and dropped. */
const OUT_OF_SCOPE = new Map<string, OutOfScopeCategory>([
  ['transaction', 'transaction'],
  ['span', 'span'],
  ['replay_event', 'replay'],
  ['replay_recording', 'replay'],
  ['replay_video', 'replay'],
  ['profile', 'profile'],
  ['profile_chunk', 'profile'],
  ['statsd', 'metric'],
  ['metric_buckets', 'metric'],
  ['client_report', 'client_report'],
]);

const decoder = new TextDecoder();

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

function isFilterable(fate: ItemFate): fate is OpenItem {
  return isOpen(fate) && fate.item.header.type === 'event';
}

// --- helpers ---

function parsedPayload(item: EnvelopeItem): unknown {
  try {
    return JSON.parse(decoder.decode(item.payload));
  } catch {
    return undefined;
  }
}

export function classifyItem(type: string): ItemClass {
  const inScope = IN_SCOPE.get(type);
  if (inScope) return { scope: 'in', category: inScope };
  const outOfScope = OUT_OF_SCOPE.get(type);
  if (outOfScope) return { scope: 'out', category: outOfScope };
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

/** The user agent the Arrival was sent with, which the web-crawlers filter also reads. */
export function arrivalUserAgent(arrival: Arrival): string | null {
  return arrival.headers['user-agent'] ?? null;
}

/** Filter every open event an Inbound Filter matches; an event that does not parse is left to processing. */
export function applyInboundFilters({
  fates,
  filters,
  userAgent,
}: {
  fates: readonly ItemFate[];
  filters: InboundFilterConfig;
  userAgent: string | null;
}): ItemFate[] {
  return fates.map((fate) => {
    const event = isFilterable(fate) ? parsedPayload(fate.item) : undefined;
    const filter = event === undefined ? null : matchingInboundFilter({ event, config: filters, userAgent });
    return filter ? { ...fate, verdict: { kind: 'filtered', reason: filter } } : fate;
  });
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
