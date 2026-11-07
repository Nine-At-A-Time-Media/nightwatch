import { describe, expect, it } from 'vitest';
import { admitArrival } from '../../../src/application/admit-arrival.js';
import type { Arrival, IngestSettings, ProjectConfig } from '../../../src/domain/ingest/arrival.js';
import { serializeEnvelope } from '../../../src/domain/protocol/envelope.js';
import { FakeArchiveSink } from '../../_fakes/fake-archive-sink.js';
import { FakeArrivalStream } from '../../_fakes/fake-arrival-stream.js';
import { FakeBlobStore } from '../../_fakes/fake-blob-store.js';
import { FakeClock } from '../../_fakes/fake-clock.js';
import { FakeMetricsSink } from '../../_fakes/fake-metrics-sink.js';
import { FakeProjectConfigSource } from '../../_fakes/fake-project-config-source.js';
import { FakeQuotaGate } from '../../_fakes/fake-quota-gate.js';

const PROJECT = '42';
const NOW = 1_700_000_000_000;
const enc = (s: string) => new TextEncoder().encode(s);

const settings: IngestSettings = { streamRecordLimit: 100_000, retryAdviceCeilingSeconds: 300, unavailableRetrySeconds: 30 };

function projectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    clientKeys: [{ publicKey: 'k1', active: true }],
    allowedOrigins: ['*'],
    sizeLimits: { event: 200_000, attachment: 1_000_000, arrival: 2_000_000 },
    inboundFilters: { browserExtensions: false, localhost: false, webCrawlers: false, releases: [], messages: [], addresses: [] },
    ...overrides,
  };
}

function makeDeps({ configs, limits }: { configs?: Record<string, ProjectConfig>; limits?: ConstructorParameters<typeof FakeQuotaGate>[0] } = {}) {
  return {
    config: new FakeProjectConfigSource(configs ?? { [PROJECT]: projectConfig() }),
    quota: new FakeQuotaGate(limits),
    stream: new FakeArrivalStream(),
    blobs: new FakeBlobStore(),
    metrics: new FakeMetricsSink(),
    archive: new FakeArchiveSink(),
    clock: new FakeClock(NOW),
    settings,
  };
}

type ItemSpec = { type: string; payload: unknown };

function envelope(items: readonly ItemSpec[]): Uint8Array {
  return serializeEnvelope({
    header: { event_id: 'e1' },
    items: items.map((i) => ({ header: { type: i.type }, payload: enc(typeof i.payload === 'string' ? i.payload : JSON.stringify(i.payload)) })),
  });
}

const errorItem: ItemSpec = { type: 'event', payload: { exception: { values: [{ type: 'Error', value: 'boom' }] } } };

function arrival(overrides: Partial<Arrival> = {}): Arrival {
  return {
    projectId: PROJECT,
    endpoint: 'envelope',
    headers: { 'x-sentry-auth': 'Sentry sentry_key=k1, sentry_version=7' },
    query: {},
    pathKey: null,
    origin: null,
    body: envelope([errorItem]),
    ...overrides,
  };
}

const outcome = (kind: string, reason: string | null, category: string, quantity = 1) => ({
  projectId: PROJECT,
  recordedAt: NOW,
  kind,
  reason,
  category,
  quantity,
});

describe('admitArrival', () => {
  it('An SDK event is accepted: Given an active Client Key, When an SDK sends an error, Then Nightwatch acknowledges it and records an accepted Outcome', async () => {
    const deps = makeDeps();
    const sent = arrival();
    const admission = await admitArrival(sent, deps);

    expect(admission.decision).toBe('admitted');
    expect(admission.status).toBe(200);
    expect(admission.outcomes).toEqual([outcome('accepted', null, 'error')]);
    expect(deps.stream.records).toHaveLength(1);
    const record = deps.stream.records[0]!;
    expect(admission.decision === 'admitted' && admission.recordId).toBe(record.id);
    expect(record).toMatchObject({ projectId: PROJECT, receivedAt: NOW, endpoint: 'envelope', blobKey: null });
    expect(record.body).toEqual(sent.body);
    expect(deps.metrics.recorded).toEqual(admission.outcomes);
    expect(deps.archive.archived).toEqual(admission.outcomes);
  });

  it('An SDK event is accepted: one Outcome per item, each in its own category', async () => {
    const deps = makeDeps();
    const body = envelope([errorItem, { type: 'session', payload: { sid: 's1' } }, { type: 'feedback', payload: { message: 'hi' } }]);
    const admission = await admitArrival(arrival({ body }), deps);

    expect(admission.outcomes).toEqual([outcome('accepted', null, 'error'), outcome('accepted', null, 'session'), outcome('accepted', null, 'feedback')]);
    expect(deps.stream.records[0]!.body).toEqual(body);
  });

  it('An SDK event is accepted: the legacy store endpoint carries one error', async () => {
    const deps = makeDeps();
    const admission = await admitArrival(arrival({ endpoint: 'store', body: enc('{"message":"boom"}') }), deps);

    expect(admission.decision).toBe('admitted');
    expect(admission.outcomes).toEqual([outcome('accepted', null, 'error')]);
    expect(deps.stream.records[0]!.endpoint).toBe('store');
  });

  it('a malformed envelope is refused as invalid and nothing is written', async () => {
    const deps = makeDeps();
    const admission = await admitArrival(arrival({ body: enc('not json\n') }), deps);

    expect(admission).toMatchObject({ decision: 'refused', status: 400 });
    expect(admission.outcomes).toEqual([outcome('invalid', 'malformed-envelope-header', 'default')]);
    expect(deps.stream.records).toHaveLength(0);
  });
});
