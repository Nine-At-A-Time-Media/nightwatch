/**
 * admitArrival -- the ingest use case (design Behaviors: Ingest; Operating:
 * Noisy tenant). Decides one Arrival, makes the admitted part durable, and
 * records exactly one Outcome per item to the MetricsSink and ArchiveSink.
 *
 * Order: access and size checks (one Outcome for the whole Arrival), then per
 * item: size, kind, Inbound Filters, Quotas; then the BlobStore and the
 * ArrivalStream; only then is anything accepted.
 */

import { checkAccess, type Access } from '../domain/ingest/access.js';
import {
  arrivalOutcome,
  arrivalRecord,
  arrivalRecordId,
  decideAdmission,
  needsBlob,
  rawBlobKey,
  refuseArrival,
  retainedAssertion,
  storageAdvice,
  storageVerdict,
  type Admission,
} from '../domain/ingest/admission.js';
import type { Arrival, Durability, IngestSettings } from '../domain/ingest/arrival.js';
import {
  applyInboundFilters,
  arrivalEnvelope,
  arrivalUserAgent,
  isOpen,
  isOversizeArrival,
  itemOutcomes,
  keptBody,
  settleOpenItems,
  triageItems,
  type ItemFate,
} from '../domain/ingest/items.js';
import { applyQuotaDenials, capRetryAdvice, openQuantities } from '../domain/ingest/quota.js';
import type { Envelope } from '../domain/protocol/envelope.js';
import type { DataCategory, RetryAdviceEntry } from '../domain/protocol/retry-advice.js';
import { isRefusal } from '../domain/refusal.js';
import type { ArchiveSink } from '../ports/archive-sink.js';
import type { ArrivalStream } from '../ports/arrival-stream.js';
import type { BlobStore } from '../ports/blob-store.js';
import type { Clock } from '../ports/clock.js';
import type { Ids } from '../ports/ids.js';
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
  readonly ids: Ids;
  readonly settings: IngestSettings;
};

type Retained = { readonly recordId: string; readonly storage: Durability };

// --- outcomes ---

async function finish(admission: Admission, deps: AdmitArrivalDeps): Promise<Admission> {
  await deps.metrics.record(admission.outcomes);
  await deps.archive.outcomes(admission.outcomes);
  return admission;
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

// --- quotas ---

/** Ask the QuotaGate for each category's open items; the capped advice of every denial. */
async function checkQuotas({
  arrival,
  access,
  fates,
  deps,
}: {
  arrival: Arrival;
  access: Access;
  fates: readonly ItemFate[];
  deps: AdmitArrivalDeps;
}): Promise<Map<DataCategory, RetryAdviceEntry>> {
  const denials = new Map<DataCategory, RetryAdviceEntry>();
  for (const { category, quantity } of openQuantities(fates)) {
    const decision = await deps.quota.check({ projectId: arrival.projectId, publicKey: access.credentials.publicKey, category, quantity });
    if (!decision.allowed) {
      denials.set(category, capRetryAdvice({ entry: decision.advice, ceilingSeconds: deps.settings.retryAdviceCeilingSeconds }));
    }
  }
  return denials;
}

// --- durability ---

/** Make the kept part durable: the body to the BlobStore first when it must go there, then the record to the stream. */
async function retain({
  arrival,
  envelope,
  fates,
  receivedAt,
  deps,
}: {
  arrival: Arrival;
  envelope: Envelope;
  fates: readonly ItemFate[];
  receivedAt: number;
  deps: AdmitArrivalDeps;
}): Promise<Retained> {
  const body = keptBody({ arrival, envelope, fates });
  const recordId = arrivalRecordId({ receivedAt, unique: deps.ids.newId() });
  const blobKey = needsBlob({ endpoint: arrival.endpoint, body, fates, settings: deps.settings })
    ? rawBlobKey({ projectId: arrival.projectId, recordId })
    : null;
  if (blobKey !== null) {
    const stored = await deps.blobs.put(blobKey, body);
    if (!stored.ok) return { recordId, storage: stored };
  }
  const storage = await deps.stream.append(
    arrivalRecord({ id: recordId, arrival, receivedAt, body, blobKey, assertion: retainedAssertion({ arrival, fates }) }),
  );
  return { recordId, storage };
}

// --- entry ---

export async function admitArrival(arrival: Arrival, deps: AdmitArrivalDeps): Promise<Admission> {
  const receivedAt = deps.clock.now();
  const access = checkAccess({ arrival, config: await deps.config.get(arrival.projectId) });
  if (isRefusal(access)) return refuse({ arrival, receivedAt, reason: access.refusal, deps });
  if (isOversizeArrival({ arrival, limits: access.config.sizeLimits })) return refuse({ arrival, receivedAt, reason: 'too-large', deps });
  const envelope = arrivalEnvelope(arrival);
  if (isRefusal(envelope)) return refuse({ arrival, receivedAt, reason: envelope.refusal, deps });

  // Milestone: each item's fate before durability.
  const triaged = triageItems({ envelope, limits: access.config.sizeLimits });
  const unfiltered = applyInboundFilters({ fates: triaged, filters: access.config.inboundFilters, userAgent: arrivalUserAgent(arrival) });
  const denials = await checkQuotas({ arrival, access, fates: unfiltered, deps });
  const fates = applyQuotaDenials({ fates: unfiltered, denials });

  // Milestone: durable before acknowledged.
  const retained = fates.some(isOpen) ? await retain({ arrival, envelope, fates, receivedAt, deps }) : null;
  const storage = retained?.storage ?? null;
  const decided = settleOpenItems({ fates, verdict: storageVerdict(storage) });
  const outcomes = itemOutcomes({
    fates: decided,
    projectId: arrival.projectId,
    recordedAt: receivedAt,
    recordId: retained?.recordId ?? null,
  });
  const retryAdvice = [...denials.values(), ...storageAdvice({ storage, settings: deps.settings })];
  return finish(decideAdmission({ fates: decided, outcomes, recordId: retained?.recordId ?? null, retryAdvice, storage }), deps);
}
