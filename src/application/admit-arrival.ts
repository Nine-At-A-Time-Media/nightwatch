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
import type { Arrival, IngestSettings, ProjectConfig } from '../domain/ingest/arrival.js';
import { checkAccess } from '../domain/ingest/access.js';
import {
  arrivalEnvelope,
  isOpen,
  isOversizeArrival,
  itemOutcomes,
  keptBody,
  settleOpenItems,
  triageItems,
} from '../domain/ingest/items.js';
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

async function retain({
  arrival,
  receivedAt,
  body,
  deps,
}: {
  arrival: Arrival;
  receivedAt: number;
  body: Uint8Array;
  deps: AdmitArrivalDeps;
}): Promise<string> {
  const id = await arrivalRecordId({ projectId: arrival.projectId, receivedAt, body: arrival.body });
  await deps.stream.append(arrivalRecord({ id, arrival, receivedAt, body }));
  return id;
}

function refuse({
  arrival,
  receivedAt,
  reason,
  deps,
}: {
  arrival: Arrival;
  receivedAt: number;
  reason: string;
  deps: AdmitArrivalDeps;
}): Promise<Admission> {
  return finish(refuseArrival({ outcome: arrivalOutcome({ arrival, recordedAt: receivedAt, kind: 'invalid', reason }) }), deps);
}

// --- entry ---

export async function admitArrival(arrival: Arrival, deps: AdmitArrivalDeps): Promise<Admission> {
  const receivedAt = deps.clock.now();
  const config: ProjectConfig | null = await deps.config.get(arrival.projectId);
  const access = checkAccess({ arrival, config });
  if (isRefusal(access)) return refuse({ arrival, receivedAt, reason: access.refusal, deps });
  if (isOversizeArrival({ arrival, limits: access.config.sizeLimits })) return refuse({ arrival, receivedAt, reason: 'too-large', deps });
  const envelope = arrivalEnvelope(arrival);
  if (isRefusal(envelope)) return refuse({ arrival, receivedAt, reason: envelope.refusal, deps });
  const fates = triageItems({ envelope, limits: access.config.sizeLimits });
  const body = keptBody({ arrival, envelope, fates });
  const recordId = fates.some(isOpen) ? await retain({ arrival, receivedAt, body, deps }) : null;
  const decided = settleOpenItems({ fates, verdict: { kind: 'accepted', reason: null } });
  const outcomes = itemOutcomes({ fates: decided, projectId: arrival.projectId, recordedAt: receivedAt });
  return finish(decideAdmission({ fates: decided, outcomes, recordId }), deps);
}
