/**
 * The pump's rules (architecture Mechanism, Stream consumption and
 * processing): which pump pulls which subscription, how many records a pull
 * takes, when a record that keeps failing has passed its retry bound, and
 * what becomes of it then -- a dead letter under `deadletter/` and a
 * `discarded` Outcome. Also how one pulled batch settles into acks and nacks.
 */

import type { ArrivalRecord } from '../ingest/arrival.js';
import type { LeasedRecord } from '../ingest/subscription.js';
import type { Outcome } from '../outcome/outcome.js';

/** One pump: the subscription it pulls and the worker id it holds leases under. */
export type Pump = { readonly subscription: string; readonly workerId: string };

/**
 * Pump settings, read once by the processor composition root.
 * - batchSize: records leased per pull.
 * - retryBound: deliveries a failing record gets before it is dead-lettered.
 */
export type PumpSettings = { readonly batchSize: number; readonly retryBound: number };

/** How one leased record settled: acked or released, the Outcomes processing gave it, and its dead-letter Outcome if it was dead-lettered. */
export type Settlement = {
  readonly offset: number;
  readonly disposition: 'ack' | 'nack';
  readonly outcomes: readonly Outcome[];
  readonly deadLettered: Outcome | null;
};

const DEAD_LETTER_PREFIX = 'deadletter/';
const DEAD_LETTER_REASON = 'dead-letter';
const encoder = new TextEncoder();

// --- predicates ---

export function isPastRetryBound(leased: LeasedRecord, retryBound: number): boolean {
  return leased.deliveries >= retryBound;
}

// --- helpers: dead letters ---

export function deadLetterKey(record: ArrivalRecord): string {
  return `${DEAD_LETTER_PREFIX}${record.id}`;
}

/** The Outcome of a record that failed past its retry bound: discarded, in the default category, as of its receipt. */
export function deadLetterOutcome(record: ArrivalRecord): Outcome {
  return {
    projectId: record.projectId,
    recordedAt: record.receivedAt,
    kind: 'discarded',
    reason: DEAD_LETTER_REASON,
    category: 'default',
    quantity: 1,
  };
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The dead letter written for a record: the record as retained (an inline body as base64), where it sat, how often it was tried, and why it failed. */
export function deadLetter({ leased, failure, at }: { leased: LeasedRecord; failure: string; at: number }): Uint8Array {
  const { record } = leased;
  const retained = { ...record, body: record.body === null ? null : base64(record.body) };
  return encoder.encode(
    JSON.stringify({ record: retained, offset: leased.offset, deliveries: leased.deliveries, failure, deadLetteredAt: at }),
  );
}

/** What a thrown failure is called in a dead letter. */
export function failureText(error: unknown): string {
  return String(error);
}

// --- helpers: settling a batch ---

export function settledOffsets(settlements: readonly Settlement[]): { ack: number[]; nack: number[] } {
  return {
    ack: settlements.filter((s) => s.disposition === 'ack').map((s) => s.offset),
    nack: settlements.filter((s) => s.disposition === 'nack').map((s) => s.offset),
  };
}
