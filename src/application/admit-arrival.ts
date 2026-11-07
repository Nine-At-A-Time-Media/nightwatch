/**
 * admitArrival -- the ingest use case (design Behaviors: Ingest; Operating:
 * Noisy tenant). Decides one Arrival, makes the admitted part durable, and
 * records exactly one Outcome per item to the MetricsSink and ArchiveSink.
 */

import {
  arrivalOutcome,
  arrivalRecord,
  arrivalRecordId,
  decideAdmission,
  refuseArrival,
  type Admission,
} from '../domain/ingest/admission.js';
import type { Arrival, IngestSettings } from '../domain/ingest/arrival.js';
import { arrivalEnvelope, isOpen, itemOutcomes, settleOpenItems, triageItems } from '../domain/ingest/items.js';
import type { Outcome } from '../domain/outcome/outcome.js';
import { isRefusal } from '../domain/refusal.js';
import type { ArchiveSink } from '../ports/archive-sink.js';
import type { ArrivalStream } from '../ports/arrival-stream.js';
import type { BlobStore } from '../ports/blob-store.js';
import type { Clock } from '../ports/clock.js';
import type { MetricsSink } from '../ports/metrics-sink.js';
import type { ProjectConfigSource } from '../ports/project-config-source.js';
import type { QuotaGate } from '../ports/quota-gate.js';

export type AdmitArrivalDeps = {
  readonly config: ProjectConfigSource;
  readonly quota: QuotaGate;
  readonly stream: ArrivalStream;
  readonly blobs: BlobStore;
  readonly metrics: MetricsSink;
  readonly archive: ArchiveSink;
  readonly clock: Clock;
  readonly settings: IngestSettings;
};

// --- flow ---

async function recordOutcomes(outcomes: readonly Outcome[], deps: AdmitArrivalDeps): Promise<void> {
  await deps.metrics.record(outcomes);
  await deps.archive.outcomes(outcomes);
}

async function finish(admission: Admission, deps: AdmitArrivalDeps): Promise<Admission> {
  await recordOutcomes(admission.outcomes, deps);
  return admission;
}

async function retain({ arrival, receivedAt, deps }: { arrival: Arrival; receivedAt: number; deps: AdmitArrivalDeps }): Promise<string> {
  const id = await arrivalRecordId({ projectId: arrival.projectId, receivedAt, body: arrival.body });
  await deps.stream.append(arrivalRecord({ id, arrival, receivedAt }));
  return id;
}

// --- entry ---

export async function admitArrival(arrival: Arrival, deps: AdmitArrivalDeps): Promise<Admission> {
  const receivedAt = deps.clock.now();
  const envelope = arrivalEnvelope(arrival);
  if (isRefusal(envelope)) {
    const outcome = arrivalOutcome({ arrival, recordedAt: receivedAt, kind: 'invalid', reason: envelope.refusal });
    return finish(refuseArrival({ outcome }), deps);
  }
  const fates = triageItems(envelope);
  const recordId = fates.some(isOpen) ? await retain({ arrival, receivedAt, deps }) : null;
  const decided = settleOpenItems({ fates, verdict: { kind: 'accepted', reason: null } });
  const outcomes = itemOutcomes({ fates: decided, projectId: arrival.projectId, recordedAt: receivedAt });
  return finish(decideAdmission({ fates: decided, outcomes, recordId }), deps);
}
