/**
 * reprocessRange -- an operator reprocesses a Time Range of a Project's raw
 * arrivals (design Reprocessing; Behaviors: Reprocess a range, Raw
 * retention expired, Interrupted reprocess, Reprocessing is silent;
 * architecture Mechanism, Stream consumption and processing).
 *
 * A range reaching back past Raw Retention is refused. Otherwise it reads
 * the arrival log through a subscription made at the earliest retained
 * record, named for the Project and range; skips records of other Projects
 * or received outside the range, by their server timestamp; runs each
 * remaining record through processArrival; and acks it. It stops when the
 * log has nothing more to deliver or has passed the range, and then
 * deletes the subscription.
 *
 * Counted once: processArrival is idempotent by Event id, so an Event
 * ProjectDO already counted within its dedup window is answered as a
 * duplicate and its Issue's counts stand; its scrubbed copy is stored again,
 * which is the rebuild.
 *
 * Silent: reprocessing gets processArrival's ports with the EffectQueue,
 * the ArchiveSink and the Mailer replaced by ones that keep nothing. Issue
 * Changes are what alerts, Reporter Notifications and GitHub sync act on,
 * so dropping them fires no alert, notifies no reporter and opens no
 * GitHub issue; a filing receipt is not mailed again; and nothing is
 * archived twice, so Outcome totals are unchanged.
 *
 * Interrupted: a record whose processing throws stops the run. Records
 * already reprocessed stay acked; that one and the rest of its batch are
 * released, the subscription is kept, and the Reprocessing says it did not
 * finish. Running the same range again resumes from there. Each record is
 * reprocessed whole or not at all, and a duplicate changes no count, so the
 * range's counts are its prior ones until the run finishes.
 *
 * Ports: ArrivalSubscription, Clock, and processArrival's (ControlStore,
 * BlobStore, ProjectClient and the rest).
 */

import type { LeasedRecord } from '../domain/ingest/subscription.js';
import type { ProjectId } from '../domain/ids.js';
import {
  isPastRange,
  isRawExpired,
  isReprocessed,
  reprocessingSubscription,
  type Reprocessing,
} from '../domain/processing/reprocessing.js';
import { refusal, type Refusal } from '../domain/refusal.js';
import type { RetentionPolicy } from '../domain/retention/retention.js';
import type { TimeRange } from '../domain/time-range.js';
import type { ArchiveSink } from '../ports/archive-sink.js';
import type { ArrivalSubscription } from '../ports/arrival-subscription.js';
import type { Clock } from '../ports/clock.js';
import type { EffectQueue } from '../ports/effect-queue.js';
import type { Mailer } from '../ports/mailer.js';
import { processArrival, type ProcessArrivalDeps } from './process-arrival.js';

/** `processing` is what processArrival is given in the processor; reprocessing silences its effects. */
export type ReprocessRangeDeps = {
  subscription: ArrivalSubscription;
  processing: ProcessArrivalDeps;
  clock: Clock;
  retention: RetentionPolicy;
};

/** Where one reprocess reads, and what it takes. */
type Scope = { readonly projectId: ProjectId; readonly range: TimeRange; readonly subscription: string };

type BatchTally = { readonly reprocessed: number; readonly skipped: number; readonly interrupted: boolean };

const WORKER_ID = 'reprocess';
const BATCH_SIZE = 50;

const SILENT_EFFECTS: EffectQueue = { enqueue: async () => undefined };
const SILENT_ARCHIVE: ArchiveSink = { outcomes: async () => undefined, events: async () => undefined };
const SILENT_MAILER: Mailer = { send: async () => ({ ok: true }) };

// --- helpers ---

function silenced(processing: ProcessArrivalDeps): ProcessArrivalDeps {
  return { ...processing, effects: SILENT_EFFECTS, archive: SILENT_ARCHIVE, mailer: SILENT_MAILER };
}

function offsetsOf(batch: readonly LeasedRecord[]): number[] {
  return batch.map((leased) => leased.offset);
}

function tallied(reprocessing: Reprocessing, batch: BatchTally): Reprocessing {
  return {
    ...reprocessing,
    reprocessed: reprocessing.reprocessed + batch.reprocessed,
    skipped: reprocessing.skipped + batch.skipped,
  };
}

// --- flow: one record ---

/** Reprocesses the record and acks it; false, with nothing acked, when its processing failed. */
async function reprocessRecord(leased: LeasedRecord, scope: Scope, deps: ReprocessRangeDeps): Promise<boolean> {
  try {
    await processArrival(leased.record, silenced(deps.processing));
  } catch {
    return false;
  }
  await deps.subscription.ack({ subscription: scope.subscription, workerId: WORKER_ID, offsets: [leased.offset] });
  return true;
}

// --- flow: one batch ---

async function reprocessBatch(batch: readonly LeasedRecord[], scope: Scope, deps: ReprocessRangeDeps): Promise<BatchTally> {
  let reprocessed = 0;
  let skipped = 0;
  for (const [index, leased] of batch.entries()) {
    if (!isReprocessed(leased.record, scope)) {
      skipped += 1;
      await deps.subscription.ack({ subscription: scope.subscription, workerId: WORKER_ID, offsets: [leased.offset] });
      continue;
    }
    if (!(await reprocessRecord(leased, scope, deps))) {
      await deps.subscription.nack({ subscription: scope.subscription, workerId: WORKER_ID, offsets: offsetsOf(batch.slice(index)) });
      return { reprocessed, skipped, interrupted: true };
    }
    reprocessed += 1;
  }
  return { reprocessed, skipped, interrupted: false };
}

// --- flow: the range ---

async function reprocessAll(scope: Scope, deps: ReprocessRangeDeps): Promise<Reprocessing> {
  let reprocessing: Reprocessing = { projectId: scope.projectId, range: scope.range, finished: false, reprocessed: 0, skipped: 0 };
  for (;;) {
    const batch = await deps.subscription.pull({ subscription: scope.subscription, workerId: WORKER_ID, max: BATCH_SIZE });
    if (batch.length === 0) return { ...reprocessing, finished: true };
    const tally = await reprocessBatch(batch, scope, deps);
    reprocessing = tallied(reprocessing, tally);
    if (tally.interrupted) return reprocessing;
    if (batch.every((leased) => isPastRange(leased.record, scope.range))) return { ...reprocessing, finished: true };
  }
}

// --- exports ---

export async function reprocessRange(project: ProjectId, range: TimeRange, deps: ReprocessRangeDeps): Promise<Reprocessing | Refusal> {
  if (isRawExpired({ range, now: deps.clock.now(), rawRetention: deps.retention.raw })) return refusal('raw_expired');
  const scope: Scope = { projectId: project, range, subscription: reprocessingSubscription({ projectId: project, range }) };
  await deps.subscription.subscribe({ subscription: scope.subscription, start: 'earliest' });
  const reprocessing = await reprocessAll(scope, deps);
  if (reprocessing.finished) await deps.subscription.unsubscribe({ subscription: scope.subscription });
  return reprocessing;
}
