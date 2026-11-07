/**
 * Admission -- the decision on one Arrival (design Domain Language): admitted
 * with its Arrival Record id and Outcomes, or refused with its Outcomes and
 * Retry Advice. Also the pure rules that build an Arrival Record.
 */

import type { Outcome, OutcomeCategory, OutcomeKind } from '../outcome/outcome.js';
import type { RetryAdvice } from '../protocol/retry-advice.js';
import type { Arrival, ArrivalRecord, EndpointKind } from './arrival.js';
import type { DecidedItem } from './items.js';

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

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
const encoder = new TextEncoder();

// --- predicates ---

function hasVerdict(fates: readonly DecidedItem[], kind: OutcomeKind): boolean {
  return fates.some((fate) => fate.verdict.kind === kind);
}

// --- helpers ---

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
 * The Admission once every item has its fate and its Outcome: admitted when
 * any item was accepted, or when nothing was refused (all filtered or
 * discarded); refused when items were only rate limited or invalid.
 */
export function decideAdmission({
  fates,
  outcomes,
  recordId,
  retryAdvice,
}: {
  fates: readonly DecidedItem[];
  outcomes: readonly Outcome[];
  recordId: string | null;
  retryAdvice: RetryAdvice;
}): Admission {
  if (hasVerdict(fates, 'accepted')) return { decision: 'admitted', status: 200, recordId, outcomes, retryAdvice };
  if (hasVerdict(fates, 'rate_limited')) return { decision: 'refused', status: 429, outcomes, retryAdvice };
  const invalid = fates.find((fate) => fate.verdict.kind === 'invalid');
  if (invalid) return { decision: 'refused', status: refusalStatus(invalid.verdict.reason), outcomes, retryAdvice };
  return { decision: 'admitted', status: 200, recordId: null, outcomes, retryAdvice };
}

/** A stable id for an Arrival Record, derived from its Project, receipt time and body. */
export async function arrivalRecordId({
  projectId,
  receivedAt,
  body,
}: {
  projectId: string;
  receivedAt: number;
  body: Uint8Array;
}): Promise<string> {
  const prefix = encoder.encode(`${projectId}\n${receivedAt}\n`);
  const material = new Uint8Array(prefix.length + body.length);
  material.set(prefix);
  material.set(body, prefix.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', material));
  const hex = Array.from(digest.subarray(0, 16), (byte) => HEX[byte] ?? '').join('');
  return `${receivedAt.toString(36)}-${hex}`;
}

export function arrivalRecord({
  id,
  arrival,
  receivedAt,
  body,
}: {
  id: string;
  arrival: Arrival;
  receivedAt: number;
  body: Uint8Array;
}): ArrivalRecord {
  return { id, projectId: arrival.projectId, receivedAt, endpoint: arrival.endpoint, body, blobKey: null };
}
