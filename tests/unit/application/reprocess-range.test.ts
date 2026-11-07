// reprocessRange -- an operator reprocesses a Time Range of raw arrivals,
// driven by its architecture signature with in-memory fakes: the arrival log
// is the FakeArrivalStream, the processor's ports are processArrival's fakes,
// and the Project's state is reached through the FakeProjectClient.
import { describe, expect, it } from 'vitest';
import { processArrival, type ProcessArrivalDeps } from '../../../src/application/process-arrival.js';
import { reprocessRange } from '../../../src/application/reprocess-range.js';
import { eventBlobKey } from '../../../src/domain/event/event-summary.js';
import { gv1 } from '../../../src/domain/grouping/grouping-version.js';
import type { ArrivalRecord, Durability } from '../../../src/domain/ingest/arrival.js';
import type { ProcessingConfig } from '../../../src/domain/processing/processing.js';
import { reprocessingSubscription } from '../../../src/domain/processing/reprocessing.js';
import { serializeEnvelope } from '../../../src/domain/protocol/envelope.js';
import type { RetentionPolicy } from '../../../src/domain/retention/retention.js';
import type { TimeRange } from '../../../src/domain/time-range.js';
import type { BlobStore } from '../../../src/ports/blob-store.js';
import { FakeArchiveSink } from '../../_fakes/fake-archive-sink.js';
import { FakeMonitorClient } from '../../_fakes/fake-monitor-client.js';
import { FakeArrivalStream } from '../../_fakes/fake-arrival-stream.js';
import { ADA, DAY, HOUR, ORG, PROJECT, T0, assertionOf, world as reportsWorld } from './reports/world.js';

const OTHER_PROJECT = 'project-2';
const RANGE: TimeRange = { start: T0, end: T0 + DAY };
const enc = (s: string) => new TextEncoder().encode(s);

const retention: RetentionPolicy = {
  raw: 7 * DAY,
  event: 90 * DAY,
  attachment: 30 * DAY,
  report: 180 * DAY,
  outcome: 90 * DAY,
  history: 90 * DAY,
};

const processingConfig: ProcessingConfig = {
  scrubbing: { ipAddresses: false, project: [] },
  grouping: { version: gv1, fingerprintRules: [], stackTraceRules: [] },
  eventRetentionMs: 90 * DAY,
};

/** BlobStore that fails every put after the first `allowed`, as storage going away mid-run would. */
class BlobStoreFailingAfter implements BlobStore {
  readonly #inner: BlobStore;
  #allowed: number;

  constructor(inner: BlobStore, allowed: number) {
    this.#inner = inner;
    this.#allowed = allowed;
  }

  async put(key: string, bytes: Uint8Array): Promise<Durability> {
    if (this.#allowed <= 0) return { ok: false, retryable: true };
    this.#allowed -= 1;
    return this.#inner.put(key, bytes);
  }

  get(key: string): Promise<Uint8Array | null> {
    return this.#inner.get(key);
  }

  delete(key: string): Promise<void> {
    return this.#inner.delete(key);
  }
}

function world() {
  const w = reportsWorld();
  w.control.addProject(ORG, OTHER_PROJECT);
  w.control.setProcessingConfig(PROJECT, processingConfig);
  w.control.setProcessingConfig(OTHER_PROJECT, processingConfig);
  const archive = new FakeArchiveSink();
  const processing: ProcessArrivalDeps = {
    ...w,
    archive,
    monitors: new FakeMonitorClient(),
    settings: { clampFutureMs: 60_000, maxTagValueLength: 200 },
    reportSettings: w.settings,
  };
  const stream = new FakeArrivalStream({ clock: w.clock });
  const deps = { subscription: stream, processing, clock: w.clock, retention };
  return { ...w, archive, processing, stream, deps };
}

type World = ReturnType<typeof world>;

function errorEvent(eventId: string): { type: string; payload: unknown } {
  return {
    type: 'event',
    payload: {
      event_id: eventId,
      timestamp: T0 / 1000,
      platform: 'python',
      release: 'api@1.0.0',
      exception: {
        values: [{ type: 'PaymentError', value: 'declined', stacktrace: { frames: [{ module: 'app.pay', function: 'charge' }] } }],
      },
    },
  };
}

function record(spec: {
  id: string;
  items: readonly { type: string; payload: unknown }[];
  receivedAt: number;
  projectId?: string;
  assertion?: string;
}): ArrivalRecord {
  const body = serializeEnvelope({
    header: {},
    items: spec.items.map((item) => ({ header: { type: item.type }, payload: enc(JSON.stringify(item.payload)) })),
  });
  return {
    id: spec.id,
    projectId: spec.projectId ?? PROJECT,
    receivedAt: spec.receivedAt,
    endpoint: 'envelope',
    assertion: spec.assertion ?? null,
    body,
    blobKey: null,
  };
}

/** Appends the records to the log and processes each once, as the pump would. */
async function ingestAndProcess(w: World, records: readonly ArrivalRecord[]): Promise<void> {
  for (const held of records) {
    await w.stream.append(held);
    await processArrival(held, w.processing);
  }
}

/** Each Issue's count and user count across both Projects. */
async function counts(w: World): Promise<readonly (readonly [string, number])[]> {
  const issues = [...(await w.projects.store(PROJECT).listIssues()), ...(await w.projects.store(OTHER_PROJECT).listIssues())];
  return issues.map((issue) => [issue.issueId, issue.count] as const);
}

const eventA = 'a'.repeat(32);
const eventB = 'b'.repeat(32);
const eventC = 'c'.repeat(32);

describe('reprocessRange', () => {
  it('Reprocess a range: Given raw arrivals in a time range, When an operator reprocesses it, Then the derived events are rebuilt once, and counts equal a single processing', async () => {
    const w = world();
    await ingestAndProcess(w, [
      record({ id: 'before', items: [errorEvent('d'.repeat(32))], receivedAt: T0 - HOUR }),
      record({ id: 'r1', items: [errorEvent(eventA)], receivedAt: T0 }),
      record({ id: 'other', items: [errorEvent('e'.repeat(32))], receivedAt: T0, projectId: OTHER_PROJECT }),
      record({ id: 'r2', items: [errorEvent(eventB)], receivedAt: T0 + HOUR }),
    ]);
    const before = await counts(w);
    await w.blobs.delete(eventBlobKey({ projectId: PROJECT, eventId: eventA }));
    w.clock.set(T0 + 2 * HOUR);

    const reprocessing = await reprocessRange(PROJECT, RANGE, w.deps);

    expect(reprocessing).toEqual({ projectId: PROJECT, range: RANGE, finished: true, reprocessed: 2, skipped: 2 });
    expect(await w.blobs.get(eventBlobKey({ projectId: PROJECT, eventId: eventA }))).not.toBeNull();
    expect(await counts(w)).toEqual(before);
    expect(w.stream.hasSubscription(reprocessingSubscription({ projectId: PROJECT, range: RANGE }))).toBe(false);
  });

  it('Reprocessing is silent: Given a range whose events already caused alerts, Reporter Notifications and GitHub issues, When an operator reprocesses it, Then none of them is sent, fired or opened again', async () => {
    const w = world();
    const feedback = { type: 'feedback', payload: { contexts: { feedback: { message: 'the save button does nothing' } } } };
    await ingestAndProcess(w, [
      record({ id: 'r1', items: [errorEvent(eventA)], receivedAt: T0 }),
      record({ id: 'r2', items: [feedback], receivedAt: T0 + HOUR, assertion: assertionOf(ADA) }),
    ]);
    const effects = w.effects.enqueued.length;
    const archived = [w.archive.archived.length, w.archive.archivedEvents.length];
    expect(effects).toBeGreaterThan(0);
    expect(w.mailer.sentTo(ADA)).toHaveLength(1);
    w.clock.set(T0 + 2 * HOUR);

    await reprocessRange(PROJECT, RANGE, w.deps);

    expect(w.effects.enqueued).toHaveLength(effects);
    expect(w.mailer.sent).toHaveLength(1);
    expect([w.archive.archived.length, w.archive.archivedEvents.length]).toEqual(archived);
    expect(await w.projects.store(PROJECT).reportsBy({ email: ADA })).toHaveLength(1);
  });

  it('enqueues no Issue Change and archives nothing even for an event the Project counts for the first time', async () => {
    const w = world();
    await w.stream.append(record({ id: 'never-pumped', items: [errorEvent(eventC)], receivedAt: T0 }));
    w.clock.set(T0 + HOUR);

    const reprocessing = await reprocessRange(PROJECT, RANGE, w.deps);

    expect(reprocessing).toMatchObject({ finished: true, reprocessed: 1 });
    expect(await w.projects.store(PROJECT).listIssues()).toHaveLength(1);
    expect(w.effects.enqueued).toEqual([]);
    expect([w.archive.archived, w.archive.archivedEvents]).toEqual([[], []]);
  });

  it("Interrupted reprocess: Given an operator's reprocess of a range, When it stops before finishing, Then the range holds either its prior derived state or its fully rebuilt state, never a mix, and the operator is told it did not finish", async () => {
    const w = world();
    await ingestAndProcess(w, [
      record({ id: 'r1', items: [errorEvent(eventA)], receivedAt: T0 }),
      record({ id: 'r2', items: [errorEvent(eventB)], receivedAt: T0 + HOUR }),
      record({ id: 'r3', items: [errorEvent(eventC)], receivedAt: T0 + 2 * HOUR }),
    ]);
    const before = await counts(w);
    w.clock.set(T0 + 3 * HOUR);

    const failing = { ...w.deps, processing: { ...w.processing, blobs: new BlobStoreFailingAfter(w.blobs, 1) } };
    const interrupted = await reprocessRange(PROJECT, RANGE, failing);

    expect(interrupted).toEqual({ projectId: PROJECT, range: RANGE, finished: false, reprocessed: 1, skipped: 0 });
    expect(await counts(w)).toEqual(before);
    expect(w.stream.hasSubscription(reprocessingSubscription({ projectId: PROJECT, range: RANGE }))).toBe(true);

    const resumed = await reprocessRange(PROJECT, RANGE, w.deps);

    expect(resumed).toEqual({ projectId: PROJECT, range: RANGE, finished: true, reprocessed: 2, skipped: 0 });
    expect(await counts(w)).toEqual(before);
    expect(w.stream.hasSubscription(reprocessingSubscription({ projectId: PROJECT, range: RANGE }))).toBe(false);
  });

  it('Raw retention expired: Given an arrival older than Raw Retention, When an operator asks to reprocess it, Then Nightwatch refuses and says it has expired', async () => {
    const w = world();
    await ingestAndProcess(w, [record({ id: 'r1', items: [errorEvent(eventA)], receivedAt: T0 })]);
    w.clock.set(T0 + 7 * DAY + 1);

    expect(await reprocessRange(PROJECT, RANGE, w.deps)).toEqual({ refusal: 'raw_expired' });
    expect(w.stream.hasSubscription(reprocessingSubscription({ projectId: PROJECT, range: RANGE }))).toBe(false);
  });
});
