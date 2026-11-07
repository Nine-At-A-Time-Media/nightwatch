/**
 * Processing -- the values processArrival exchanges (architecture Use-case
 * surface, Processing and grouping; Mechanism, Stream consumption and
 * processing): what processing reads about a Project, the settings it is
 * given, how each retained item is routed, the Outcome of an item that
 * processing decides, the user key of an Event, the scrubbed Event as
 * stored, and the Processing Result of one Arrival Record.
 */

import type { GroupingRules } from '../grouping/derive.js';
import type { ArrivalRecord } from '../ingest/arrival.js';
import { classifyItem } from '../ingest/items.js';
import type { Assignment } from '../issue/assignment.js';
import type { NormalizeContext } from '../normalize/normalize.js';
import type { NormalizedEvent, User } from '../normalize/normalized-event.js';
import type { Outcome, OutcomeKind } from '../outcome/outcome.js';
import type { EnvelopeItem } from '../protocol/envelope.js';
import type { FilingReceipt } from '../report/filing.js';
import type { ProjectScrubbingRule } from '../scrub/rules.js';
import type { Removal, ScrubbedEvent } from '../scrub/scrub.js';

/** What processing reads about one Project from the control plane. */
export type ProcessingConfig = {
  readonly scrubbing: { readonly ipAddresses: boolean; readonly project: readonly ProjectScrubbingRule[] };
  readonly grouping: GroupingRules;
  /** Event Retention of the Project's Organization, milliseconds; an older Event is refused. */
  readonly eventRetentionMs: number;
};

/**
 * Processor settings, read once by the processor composition root.
 * - clampFutureMs: the Clock-drift clamp.
 * - maxTagValueLength: a tag with a longer value is dropped.
 */
export type ProcessingSettings = { readonly clampFutureMs: number; readonly maxTagValueLength: number };

/** What processing made of one Arrival Record. */
export type ProcessingResult = {
  readonly assignments: readonly Assignment[];
  readonly filingReceipts: readonly FilingReceipt[];
  /** The Outcomes processing decided: events refused or dropped, filings refused, and items left to other use cases. */
  readonly outcomes: readonly Outcome[];
};

/** Where an item goes: event processing, Report filing, or left for a use case that does not exist yet. */
export type ProcessingRoute = 'event' | 'feedback' | 'deferred';

const ROUTES = new Map<string, ProcessingRoute>([
  ['event', 'event'],
  ['feedback', 'feedback'],
  ['user_report', 'feedback'],
]);

/** The user fields that key an Event's user, most specific first, with the prefix that keeps their keys apart. */
const USER_KEY_FIELDS: readonly (readonly [keyof User, string])[] = [
  ['id', 'id'],
  ['email', 'email'],
  ['username', 'username'],
  ['ipAddress', 'ip'],
];

const decoder = new TextDecoder();
const encoder = new TextEncoder();

// --- routing ---

export function processingRoute(type: string): ProcessingRoute {
  return ROUTES.get(type) ?? 'deferred';
}

/** The Outcome of an item whose fate processing decided, in the item's own category. */
export function processingOutcome({
  record,
  type,
  kind,
  reason,
}: {
  record: ArrivalRecord;
  type: string;
  kind: OutcomeKind;
  reason: string;
}): Outcome {
  const kindOf = classifyItem(type);
  const category = kindOf.scope === 'unknown' ? 'default' : kindOf.category;
  return { projectId: record.projectId, recordedAt: record.receivedAt, kind, reason, category, quantity: 1 };
}

// --- reading items ---

/** The JSON an item carries; undefined when it is not JSON. */
export function itemPayload(item: EnvelopeItem): unknown {
  try {
    return JSON.parse(decoder.decode(item.payload));
  } catch {
    return undefined;
  }
}

function headerTime(value: unknown): Date | undefined {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? undefined : new Date(time);
}

/** How to normalize an event of this record: receipt from the record, the sender's stamp and event id from the envelope header. */
export function normalizeContext({
  record,
  header,
  config,
  settings,
}: {
  record: ArrivalRecord;
  header: Readonly<Record<string, unknown>>;
  config: ProcessingConfig;
  settings: ProcessingSettings;
}): NormalizeContext {
  const sentAt = headerTime(header['sent_at']);
  const eventId = header['event_id'];
  return {
    receivedAt: new Date(record.receivedAt),
    ...(sentAt === undefined ? {} : { sentAt }),
    ...(typeof eventId === 'string' ? { eventId } : {}),
    clampFutureMs: settings.clampFutureMs,
    retentionMs: config.eventRetentionMs,
    projectId: record.projectId,
    maxTagValueLength: settings.maxTagValueLength,
  };
}

// --- the Event as stored ---

function isRemoved(field: keyof User, removals: readonly Removal[]): boolean {
  return removals.some((removal) => removal.path === `user.${field}` || removal.path.startsWith(`user.${field}.`));
}

/** The text an Event's user is keyed by before hashing; never a field a Scrubbing Rule touched. Null when no user is named. */
export function userKeyText(event: NormalizedEvent, removals: readonly Removal[]): string | null {
  const user = event.user;
  if (user === null) return null;
  const field = USER_KEY_FIELDS.find(([name]) => user[name] !== undefined && !isRemoved(name, removals));
  return field === undefined ? null : `${field[1]}:${user[field[0]] ?? ''}`;
}

/** The scrubbed Event and its Removals, stored together so the Event shows what was removed, by which rule and how long it was. */
export function encodeScrubbedEvent(scrubbed: ScrubbedEvent): Uint8Array {
  return encoder.encode(JSON.stringify({ event: scrubbed.event, removals: scrubbed.removals }));
}

// --- the result ---

export function processingResult(parts: Partial<ProcessingResult>): ProcessingResult {
  return { assignments: parts.assignments ?? [], filingReceipts: parts.filingReceipts ?? [], outcomes: parts.outcomes ?? [] };
}

export function mergeResults(results: readonly ProcessingResult[]): ProcessingResult {
  return {
    assignments: results.flatMap((result) => result.assignments),
    filingReceipts: results.flatMap((result) => result.filingReceipts),
    outcomes: results.flatMap((result) => result.outcomes),
  };
}
