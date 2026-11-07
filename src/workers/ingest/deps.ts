/**
 * The ingest Worker's wiring: the one place that names the concrete adapter
 * behind each port admitArrival takes, and reads the ingest settings from the
 * Worker's vars. The local stage runs on the stand-ins (LogDO for K2, R2
 * NDJSON for Basin); no other stage has its adapters yet, so any other stage
 * is refused rather than silently given a stand-in.
 */

import type { AdmitArrivalDeps } from '../../application/admit-arrival.js';
import { DurableQuotaGate } from '../../adapters/do/durable-quota-gate.js';
import { KvProjectConfigSource } from '../../adapters/kv/kv-project-config-source.js';
import { LogArrivalStream } from '../../adapters/logdo/log-arrival-stream.js';
import { R2BlobStore } from '../../adapters/r2/r2-blob-store.js';
import { R2NdjsonArchiveSink } from '../../adapters/r2-ndjson/r2-ndjson-archive-sink.js';
import { RandomIds } from '../../adapters/runtime/random-ids.js';
import { SystemClock } from '../../adapters/runtime/system-clock.js';
import { NoMetricsSink, WaeMetricsSink } from '../../adapters/wae/wae-metrics-sink.js';
import type { IngestSettings } from '../../domain/ingest/arrival.js';

/** The Worker's bindings; METRICS is optional and absent on the local stage. */
export type IngestBindings = IngestEnv & { readonly METRICS?: AnalyticsEngineDataset };

/** The arrival log every ingest isolate appends to (K2's stream `arrivals`). */
const ARRIVALS = 'arrivals';
/** Ingest only appends; the lease length is the consumers' concern and unused here. */
const UNUSED_LEASE_MS = 30_000;
const LOCAL_STAGE = 'local';

// --- settings ---

function positive({ name, value }: { name: string; value: unknown }): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`ingest setting ${name} must be a positive number, got ${String(value)}`);
  return number;
}

function ingestSettings(env: IngestBindings): IngestSettings {
  return {
    streamRecordLimit: positive({ name: 'STREAM_RECORD_LIMIT', value: env.STREAM_RECORD_LIMIT }),
    retryAdviceCeilingSeconds: positive({ name: 'RETRY_ADVICE_CEILING_SECONDS', value: env.RETRY_ADVICE_CEILING_SECONDS }),
    unavailableRetrySeconds: positive({ name: 'UNAVAILABLE_RETRY_SECONDS', value: env.UNAVAILABLE_RETRY_SECONDS }),
  };
}

// --- wiring ---

export function isLocalStage(env: IngestBindings): boolean {
  return env.STAGE === LOCAL_STAGE;
}

export function ingestDeps(env: IngestBindings): AdmitArrivalDeps {
  const clock = new SystemClock();
  const ids = new RandomIds();
  const config = new KvProjectConfigSource(env.PROJECT_CONFIG);
  return {
    config,
    quota: new DurableQuotaGate({ limits: config, counterFor: (projectId) => env.QUOTA.getByName(projectId), clock }),
    stream: new LogArrivalStream({ log: env.LOG.getByName(ARRIVALS), clock, leaseMs: UNUSED_LEASE_MS }),
    blobs: new R2BlobStore(env.BLOBS),
    metrics: env.METRICS ? new WaeMetricsSink(env.METRICS) : new NoMetricsSink(),
    archive: new R2NdjsonArchiveSink({ bucket: env.BLOBS, ids }),
    clock,
    ids,
    settings: ingestSettings(env),
  };
}
