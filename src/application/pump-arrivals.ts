/**
 * pumpArrivals -- the pump loop over the arrival log (architecture Use-case
 * surface, Processing and grouping: the pump row; Mechanism, Stream
 * consumption and processing). One run subscribes the pump's subscription
 * from the earliest record (a no-op once it exists), pulls one batch under
 * the pump's worker id, and hands each record to `dispatch` -- the
 * composition root's binding of processArrival, which routes event items
 * and feedback items itself.
 *
 * A record that processes is acked. A record whose dispatch throws is nacked
 * for another delivery, until its delivery count reaches the retry bound;
 * then it is written to the BlobStore under `deadletter/`, acked, and ends in
 * a dead-letter Outcome, which is archived. A dead letter the BlobStore did
 * not take leaves the record nacked. Answers every Outcome of the batch:
 * those processing decided (processArrival archived them) and the
 * dead-letter ones.
 *
 * Ports: ArrivalSubscription, BlobStore, ArchiveSink, Clock.
 */

import type { ArrivalRecord } from '../domain/ingest/arrival.js';
import type { LeasedRecord } from '../domain/ingest/subscription.js';
import type { Outcome } from '../domain/outcome/outcome.js';
import type { ProcessingResult } from '../domain/processing/processing.js';
import {
  deadLetter,
  deadLetterKey,
  deadLetterOutcome,
  failureText,
  isPastRetryBound,
  settledOffsets,
  type Pump,
  type PumpSettings,
  type Settlement,
} from '../domain/processing/pump.js';
import type { ArchiveSink } from '../ports/archive-sink.js';
import type { ArrivalSubscription } from '../ports/arrival-subscription.js';
import type { BlobStore } from '../ports/blob-store.js';
import type { Clock } from '../ports/clock.js';

export type PumpArrivalsDeps = {
  readonly subscription: ArrivalSubscription;
  readonly blobs: BlobStore;
  readonly archive: ArchiveSink;
  readonly clock: Clock;
  /** Processes one Arrival Record; throws when a write failed and the record should be tried again. */
  readonly dispatch: (record: ArrivalRecord) => Promise<ProcessingResult>;
  readonly pump: Pump;
  readonly settings: PumpSettings;
};

// --- flow: one record ---

/** Writes the record's dead letter; acked with its Outcome once stored, released when not. */
async function deadLetterRecord(leased: LeasedRecord, failure: string, deps: PumpArrivalsDeps): Promise<Settlement> {
  const letter = deadLetter({ leased, failure, at: deps.clock.now() });
  const stored = await deps.blobs.put(deadLetterKey(leased.record), letter);
  if (!stored.ok) return { offset: leased.offset, disposition: 'nack', outcomes: [], deadLettered: null };
  const outcome = deadLetterOutcome(leased.record);
  return { offset: leased.offset, disposition: 'ack', outcomes: [outcome], deadLettered: outcome };
}

async function settle(leased: LeasedRecord, deps: PumpArrivalsDeps): Promise<Settlement> {
  let result: ProcessingResult;
  try {
    result = await deps.dispatch(leased.record);
  } catch (error) {
    if (!isPastRetryBound(leased, deps.settings.retryBound)) {
      return { offset: leased.offset, disposition: 'nack', outcomes: [], deadLettered: null };
    }
    return deadLetterRecord(leased, failureText(error), deps);
  }
  return { offset: leased.offset, disposition: 'ack', outcomes: result.outcomes, deadLettered: null };
}

// --- flow: the batch ---

async function settleAll(batch: readonly LeasedRecord[], deps: PumpArrivalsDeps): Promise<Settlement[]> {
  const settlements: Settlement[] = [];
  for (const leased of batch) settlements.push(await settle(leased, deps));
  return settlements;
}

async function release(settlements: readonly Settlement[], deps: PumpArrivalsDeps): Promise<void> {
  const { subscription, workerId } = deps.pump;
  const { ack, nack } = settledOffsets(settlements);
  if (ack.length > 0) await deps.subscription.ack({ subscription, workerId, offsets: ack });
  if (nack.length > 0) await deps.subscription.nack({ subscription, workerId, offsets: nack });
}

async function archiveDeadLetters(settlements: readonly Settlement[], archive: ArchiveSink): Promise<void> {
  const outcomes = settlements.flatMap((s) => (s.deadLettered === null ? [] : [s.deadLettered]));
  if (outcomes.length > 0) await archive.outcomes(outcomes);
}

// --- exports ---

export async function pumpArrivals(deps: PumpArrivalsDeps): Promise<Outcome[]> {
  const { subscription, workerId } = deps.pump;
  await deps.subscription.subscribe({ subscription, start: 'earliest' });
  const batch = await deps.subscription.pull({ subscription, workerId, max: deps.settings.batchSize });
  const settlements = await settleAll(batch, deps);
  await release(settlements, deps);
  await archiveDeadLetters(settlements, deps.archive);
  return settlements.flatMap((s) => s.outcomes);
}
