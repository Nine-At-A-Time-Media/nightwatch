/**
 * Session items -- the Sessions an SDK `session` or `sessions` item reports
 * (design Behaviors: Crash-free rate; Domain Language: Session; architecture
 * Mechanism, Releases, health and monitors). Processing hands each one to
 * recordSession through ProjectClient, after hashing its user.
 *
 * A `session` item is one update of one Session. The Session is counted
 * once, on its first update (`init` true), with the status that update
 * carries; a status of ok or exited with errors counted is errored. Later
 * updates of the same Session count nothing, since a counted Session never
 * moves between statuses.
 *
 * A `sessions` item sums Sessions per start minute: each row names the
 * minute, optionally a distinct id, and how many Sessions ended exited,
 * errored, abnormal or crashed; each unit is one Session.
 *
 * Both name their release and environment under `attrs`; no release, or a
 * shape these rules cannot read, refuses the whole item. No environment is
 * production; no start is the record's receipt. A distinct id is keyed as an
 * Event's user id is, so a user hashes alike in both.
 */

import { isObject } from '../normalize/parts.js';
import type { EnvelopeItem } from '../protocol/envelope.js';
import { refusal, type Refusal } from '../refusal.js';
import { SESSION_STATUSES, type Session, type SessionStatus } from '../release/health.js';
import { itemPayload } from './processing.js';

type Raw = Readonly<Record<string, unknown>>;

/** A Session as an item reports it: its user is still the text to hash, or null when the SDK named none. */
export type SessionReport = Omit<Session, 'userKey'> & { readonly userText: string | null };

type Attributes = { readonly release: string; readonly environment: string };

const MALFORMED = 'malformed-session';
const DEFAULT_ENVIRONMENT = 'production';
const AGGREGATED = 'sessions';
const USER_PREFIX = 'id:';

/** The statuses an aggregate row counts, in the order its Sessions are reported. */
const AGGREGATE_STATUSES: readonly SessionStatus[] = ['exited', 'errored', 'abnormal', 'crashed'];

// --- predicates ---

function isStatus(value: unknown): value is SessionStatus {
  return typeof value === 'string' && (SESSION_STATUSES as readonly string[]).includes(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function hasErrors(update: Raw): boolean {
  return typeof update['errors'] === 'number' && update['errors'] > 0;
}

// --- helpers ---

function attributesOf(payload: Raw): Attributes | null {
  const attrs = payload['attrs'];
  if (!isObject(attrs) || !isNonEmpty(attrs['release'])) return null;
  const environment = isNonEmpty(attrs['environment']) ? attrs['environment'] : DEFAULT_ENVIRONMENT;
  return { release: attrs['release'], environment };
}

function timeOf(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value * 1000;
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? fallback : parsed;
}

function userTextOf(value: unknown): string | null {
  return isNonEmpty(value) ? `${USER_PREFIX}${value}` : null;
}

function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

function updateStatus(update: Raw): SessionStatus | null {
  const status = update['status'];
  if (!isStatus(status)) return null;
  return (status === 'ok' || status === 'exited') && hasErrors(update) ? 'errored' : status;
}

function updateReports(payload: Raw, receivedAt: number): readonly SessionReport[] | Refusal {
  const attributes = attributesOf(payload);
  const status = updateStatus(payload);
  if (attributes === null || status === null) return refusal(MALFORMED);
  if (payload['init'] !== true) return [];
  return [{ ...attributes, status, userText: userTextOf(payload['did']), startedAt: timeOf(payload['started'], receivedAt) }];
}

function rowReports({ row, attributes, receivedAt }: { row: Raw; attributes: Attributes; receivedAt: number }): readonly SessionReport[] {
  const base = { ...attributes, userText: userTextOf(row['did']), startedAt: timeOf(row['started'], receivedAt) };
  return AGGREGATE_STATUSES.flatMap((status) => Array.from({ length: countOf(row[status]) }, () => ({ ...base, status })));
}

function aggregateReports(payload: Raw, receivedAt: number): readonly SessionReport[] | Refusal {
  const attributes = attributesOf(payload);
  const rows = payload['aggregates'];
  if (attributes === null || !Array.isArray(rows)) return refusal(MALFORMED);
  return rows.filter(isObject).flatMap((row) => rowReports({ row, attributes, receivedAt }));
}

// --- exports ---

/** The Sessions a `session` or `sessions` item reports; refused when it cannot be read. */
export function sessionReports(item: EnvelopeItem, receivedAt: number): readonly SessionReport[] | Refusal {
  const payload = itemPayload(item);
  if (!isObject(payload)) return refusal(MALFORMED);
  return item.header.type === AGGREGATED ? aggregateReports(payload, receivedAt) : updateReports(payload, receivedAt);
}
