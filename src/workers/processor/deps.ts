/**
 * The processor Worker's wiring: the one place that names the concrete
 * adapter behind each port processArrival and pumpArrivals take, and reads
 * the processor settings from the Worker's vars. The local stage runs on the
 * stand-ins (LogDO for K2, R2 NDJSON for Basin, the rules SpamJudge for
 * Workers AI, the dev/local-issuer Worker for Access); no other stage has
 * its adapters yet, so any other stage is refused rather than given a
 * stand-in.
 *
 * Sign-in: the local stage reads issuer keys only through the LOCAL_ISSUER
 * service binding to the local issuer Worker, as the console does; a
 * deployed stage reads each trusted issuer's published keys and refuses to
 * start with LOCAL_ISSUER bound (architecture, Sign-in).
 */

import { AccessSignInVerifier } from '../../adapters/access/access-sign-in-verifier.js';
import { remoteKeySource } from '../../adapters/access/key-source.js';
import { D1ControlStore } from '../../adapters/d1/d1-control-store.js';
import { D1ProjectConfigSource } from '../../adapters/d1/d1-project-config-source.js';
import { DurableProjectClient } from '../../adapters/do/durable-project-client.js';
import { DurableQuotaGate } from '../../adapters/do/durable-quota-gate.js';
import { ServiceMonitorClient } from '../../adapters/fetch/service-monitor-client.js';
import { SendEmailMailer } from '../../adapters/email/send-email-mailer.js';
import { LogArrivalStream } from '../../adapters/logdo/log-arrival-stream.js';
import { QueueEffectQueue } from '../../adapters/queues/queue-effect-queue.js';
import { R2BlobStore } from '../../adapters/r2/r2-blob-store.js';
import { R2NdjsonArchiveSink } from '../../adapters/r2-ndjson/r2-ndjson-archive-sink.js';
import { RulesSpamJudge } from '../../adapters/rules/rules-spam-judge.js';
import { RandomIds } from '../../adapters/runtime/random-ids.js';
import { SystemClock } from '../../adapters/runtime/system-clock.js';
import type { ArrivalRecord } from '../../domain/ingest/arrival.js';
import type { ProcessArrivalDeps } from '../../application/process-arrival.js';
import type { ProcessingSettings } from '../../domain/processing/processing.js';
import type { PumpSettings } from '../../domain/processing/pump.js';
import type { ReportSettings } from '../../domain/report/filing.js';
import type { ArchiveSink } from '../../ports/archive-sink.js';
import type { ArrivalSubscription } from '../../ports/arrival-subscription.js';
import type { BlobStore } from '../../ports/blob-store.js';
import type { Clock } from '../../ports/clock.js';
import type { SignInVerifier } from '../../ports/sign-in-verifier.js';
import type { ProjectDO } from '../core/project-do.js';
import type { LogDO } from '../ingest/log-do.js';
import type { QuotaDO } from '../ingest/quota-do.js';

/** The arrival log ingest appends to (K2's stream `arrivals`) and the subscription every pump shares. */
const ARRIVALS = 'arrivals';
export const SUBSCRIPTION = 'processing';
const LOCAL_STAGE = 'local';

/** How the pumps run: how many share the subscription, the alarm interval, and each run's settings. */
export type PumpPlan = { readonly count: number; readonly intervalMs: number; readonly settings: PumpSettings };

/** What one StreamPumpDO hands pumpArrivals, but its own Pump identity. */
export type PumpPorts = {
  readonly subscription: ArrivalSubscription;
  readonly blobs: BlobStore;
  readonly archive: ArchiveSink;
  readonly clock: Clock;
  /** processArrival's ports for one record; its Issue Changes go out named with the record's Project. */
  readonly processFor: (record: ArrivalRecord) => ProcessArrivalDeps;
};

/** The Durable Object bindings to other Workers' classes, which generated types leave untyped. */
type CrossScriptBindings = {
  readonly LOG: DurableObjectNamespace<LogDO>;
  readonly QUOTA: DurableObjectNamespace<QuotaDO>;
  readonly PROJECT: DurableObjectNamespace<ProjectDO>;
};

// --- settings ---

function positive({ name, value }: { name: string; value: unknown }): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`processor setting ${name} must be a positive number, got ${String(value)}`);
  return number;
}

function text({ name, value }: { name: string; value: unknown }): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`processor setting ${name} must be a non-empty string`);
  return value;
}

export function pumpPlan(env: ProcessorEnv): PumpPlan {
  return {
    count: positive({ name: 'PUMP_COUNT', value: env.PUMP_COUNT }),
    intervalMs: positive({ name: 'PUMP_INTERVAL_MS', value: env.PUMP_INTERVAL_MS }),
    settings: {
      batchSize: positive({ name: 'PUMP_BATCH_SIZE', value: env.PUMP_BATCH_SIZE }),
      retryBound: positive({ name: 'PUMP_RETRY_BOUND', value: env.PUMP_RETRY_BOUND }),
    },
  };
}

export function processingSettings(env: ProcessorEnv): ProcessingSettings {
  return {
    clampFutureMs: positive({ name: 'CLAMP_FUTURE_MS', value: env.CLAMP_FUTURE_MS }),
    maxTagValueLength: positive({ name: 'MAX_TAG_VALUE_LENGTH', value: env.MAX_TAG_VALUE_LENGTH }),
  };
}

export function reportSettings(env: ProcessorEnv): ReportSettings {
  return {
    followUpBaseUrl: text({ name: 'FOLLOW_UP_BASE_URL', value: env.FOLLOW_UP_BASE_URL }),
    maxMessageLength: positive({ name: 'MAX_MESSAGE_LENGTH', value: env.MAX_MESSAGE_LENGTH }),
    spamThreshold: positive({ name: 'SPAM_THRESHOLD', value: env.SPAM_THRESHOLD }),
  };
}

// --- sign-in ---

/** The local issuer Worker, reached over its service binding; bound on the local stage only. */
type IssuerBinding = { fetch(input: string | URL, init?: RequestInit): Promise<Response> };

function localIssuerOf(env: ProcessorEnv): IssuerBinding | undefined {
  return (env as unknown as { LOCAL_ISSUER?: IssuerBinding }).LOCAL_ISSUER;
}

export function signInVerifier(env: ProcessorEnv): SignInVerifier {
  const clock = { now: () => new Date() };
  const issuer = localIssuerOf(env);
  if (env.STAGE !== LOCAL_STAGE) {
    if (issuer) throw new Error(`stage ${env.STAGE} must not bind LOCAL_ISSUER`);
    return new AccessSignInVerifier({ keys: remoteKeySource(), clock });
  }
  if (!issuer) throw new Error('the local stage needs the LOCAL_ISSUER service binding');
  return new AccessSignInVerifier({ keys: remoteKeySource({ fetch: (url, options) => issuer.fetch(url, options) }), clock });
}

// --- wiring ---

function crossScript(env: ProcessorEnv): CrossScriptBindings {
  return env as unknown as CrossScriptBindings;
}

export function isLocalStage(env: ProcessorEnv): boolean {
  return env.STAGE === LOCAL_STAGE;
}

export function processArrivalDeps(
  env: ProcessorEnv,
  { clock, blobs, archive }: { clock: Clock; blobs: BlobStore; archive: ArchiveSink },
): (record: ArrivalRecord) => ProcessArrivalDeps {
  const ids = new RandomIds();
  const deps: Omit<ProcessArrivalDeps, 'effects'> = {
    verifier: signInVerifier(env),
    quota: new DurableQuotaGate({
      limits: new D1ProjectConfigSource(env.CONTROL),
      counterFor: (projectId) => crossScript(env).QUOTA.getByName(projectId),
      clock,
    }),
    projects: new DurableProjectClient({ namespace: crossScript(env).PROJECT }),
    control: new D1ControlStore(env.CONTROL),
    blobs,
    spam: new RulesSpamJudge(),
    mailer: new SendEmailMailer({ binding: env.EMAIL, from: text({ name: 'MAIL_FROM', value: env.MAIL_FROM }) }),
    ids,
    clock,
    archive,
    monitors: new ServiceMonitorClient({ fetch: (url, init) => env.MONITORS.fetch(url, init) }),
    settings: processingSettings(env),
    reportSettings: reportSettings(env),
  };
  return (record) => ({ ...deps, effects: new QueueEffectQueue(env.EFFECTS, () => record.projectId) });
}

/** The ports one StreamPumpDO runs on; refuses any stage but the local one. */
export function pumpPorts(env: ProcessorEnv): PumpPorts {
  if (!isLocalStage(env)) throw new Error(`stage ${env.STAGE} has no processor adapters`);
  const clock = new SystemClock();
  const blobs = new R2BlobStore(env.BLOBS);
  const archive = new R2NdjsonArchiveSink({ bucket: env.BLOBS, ids: new RandomIds() });
  const log = crossScript(env).LOG.getByName(ARRIVALS);
  const leaseMs = positive({ name: 'PUMP_LEASE_MS', value: env.PUMP_LEASE_MS });
  return {
    subscription: new LogArrivalStream({ log, clock, leaseMs }),
    blobs,
    archive,
    clock,
    processFor: processArrivalDeps(env, { clock, blobs, archive }),
  };
}
