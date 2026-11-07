/**
 * Admission -- the decision on one Arrival (design Domain Language): admitted
 * with its Arrival Record id and Outcomes, or refused with its Outcomes and
 * Retry Advice. Also the pure rules that build an Arrival Record and decide
 * where its body is kept. An Arrival is admitted only once it is durable.
 */

import type { Outcome, OutcomeCategory, OutcomeKind } from '../outcome/outcome.js';
import type { RetryAdvice, RetryAdviceEntry } from '../protocol/retry-advice.js';
import type { Arrival, ArrivalRecord, Durability, EndpointKind, IngestSettings } from './arrival.js';
import { isOpen, type DecidedItem, type ItemFate, type Verdict } from './items.js';

/** An HTTP-like status hint for the entry point that answers the SDK. */
export type AdmissionStatus = 200 | 400 | 401 | 403 | 413 | 429 | 500 | 503;

export type Admission =
  | {
      readonly decision: 'admitted';
      readonly status: 200;
      readonly recordId: string | null;
      readonly outcomes: readonly Outcome[];
      readonly retryAdvice: RetryAdvice;
    }
  | {
      readonly decision: 'refused';
      readonly status: Exclude<AdmissionStatus, 200>;
      readonly outcomes: readonly Outcome[];
      readonly retryAdvice: RetryAdvice;
    };

const ENDPOINT_CATEGORY: Readonly<Record<EndpointKind, OutcomeCategory>> = {
  envelope: 'default',
  store: 'error',
  security: 'security',
  attachment: 'attachment',
  checkin: 'monitor',
};

const REFUSAL_STATUS = new Map<string, Exclude<AdmissionStatus, 200>>([
  ['missing-credentials', 401],
  ['multiple-credentials', 401],
  ['malformed-credentials', 401],
  ['disabled-key', 401],
  ['origin-not-allowed', 403],
  ['too-large', 413],
]);

const STORAGE_UNAVAILABLE = 'storage-unavailable';

// --- predicates ---

function hasVerdict(fates: readonly DecidedItem[], kind: OutcomeKind): boolean {
  return fates.some((fate) => fate.verdict.kind === kind);
}

function isStorageFailure(storage: Durability | null): storage is { ok: false; retryable: boolean } {
  return storage !== null && !storage.ok;
}

/** A body over the stream record limit, and every attachment, is kept in the BlobStore; the record carries its key. */
export function needsBlob({
  endpoint,
  body,
  fates,
  settings,
}: {
  endpoint: EndpointKind;
  body: Uint8Array;
  fates: readonly ItemFate[];
  settings: IngestSettings;
}): boolean {
  return (
    body.length > settings.streamRecordLimit ||
    endpoint === 'attachment' ||
    fates.some((fate) => isOpen(fate) && fate.item.header.type === 'attachment')
  );
}

// --- helpers ---

export function rawBlobKey({ projectId, recordId }: { projectId: string; recordId: string }): string {
  return `raw/${projectId}/${recordId}`;
}

/** The verdict for items still open once storage has answered: accepted only if durable. */
export function storageVerdict(storage: Durability | null): Verdict {
  return isStorageFailure(storage) ? { kind: 'discarded', reason: STORAGE_UNAVAILABLE } : { kind: 'accepted', reason: null };
}

/** Retry Advice for a storage failure that retrying may fix, within the Retry advice ceiling. */
export function storageAdvice({ storage, settings }: { storage: Durability | null; settings: IngestSettings }): RetryAdviceEntry[] {
  if (!isStorageFailure(storage) || !storage.retryable) return [];
  const retryAfterSeconds = Math.min(settings.unavailableRetrySeconds, settings.retryAdviceCeilingSeconds);
  return [{ retryAfterSeconds, categories: [], scope: 'project', reason: STORAGE_UNAVAILABLE }];
}

function refusalStatus(reason: string | null): Exclude<AdmissionStatus, 200> {
  return (reason === null ? undefined : REFUSAL_STATUS.get(reason)) ?? 400;
}

/** The single Outcome of an Arrival refused before its items were read. */
export function arrivalOutcome({
  arrival,
  recordedAt,
  kind,
  reason,
}: {
  arrival: Arrival;
  recordedAt: number;
  kind: OutcomeKind;
  reason: string;
}): Outcome {
  return { projectId: arrival.projectId, recordedAt, kind, reason, category: ENDPOINT_CATEGORY[arrival.endpoint], quantity: 1 };
}

/** Refuse an Arrival before its items were read, with its one Outcome. */
export function refuseArrival({ outcome }: { outcome: Outcome }): Admission {
  return { decision: 'refused', status: refusalStatus(outcome.reason), outcomes: [outcome], retryAdvice: [] };
}

/**
 * The Admission once every item has its fate and its Outcome: refused when
 * storage failed; admitted when any item was accepted, or when nothing was
 * refused (all filtered or discarded); refused when items were only rate
 * limited or invalid.
 */
export function decideAdmission({
  fates,
  outcomes,
  recordId,
  retryAdvice,
  storage,
}: {
  fates: readonly DecidedItem[];
  outcomes: readonly Outcome[];
  recordId: string | null;
  retryAdvice: RetryAdvice;
  storage: Durability | null;
}): Admission {
  if (isStorageFailure(storage)) return { decision: 'refused', status: storage.retryable ? 503 : 500, outcomes, retryAdvice };
  if (hasVerdict(fates, 'accepted')) return { decision: 'admitted', status: 200, recordId, outcomes, retryAdvice };
  if (hasVerdict(fates, 'rate_limited')) return { decision: 'refused', status: 429, outcomes, retryAdvice };
  const invalid = fates.find((fate) => fate.verdict.kind === 'invalid');
  if (invalid) return { decision: 'refused', status: refusalStatus(invalid.verdict.reason), outcomes, retryAdvice };
  return { decision: 'admitted', status: 200, recordId: null, outcomes, retryAdvice };
}

/** The id of an Arrival Record: its receipt time, then a fresh unique part. */
export function arrivalRecordId({ receivedAt, unique }: { receivedAt: number; unique: string }): string {
  return `${receivedAt.toString(36)}-${unique}`;
}

export function arrivalRecord({
  id,
  arrival,
  receivedAt,
  body,
  blobKey,
}: {
  id: string;
  arrival: Arrival;
  receivedAt: number;
  body: Uint8Array;
  blobKey: string | null;
}): ArrivalRecord {
  const base = { id, projectId: arrival.projectId, receivedAt, endpoint: arrival.endpoint };
  return blobKey === null ? { ...base, body, blobKey } : { ...base, body: null, blobKey };
}
