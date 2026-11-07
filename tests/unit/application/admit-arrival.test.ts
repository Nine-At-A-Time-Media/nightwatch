import { describe, expect, it } from 'vitest';
import { admitArrival } from '../../../src/application/admit-arrival.js';
import type { Arrival, IngestSettings, ProjectConfig } from '../../../src/domain/ingest/arrival.js';
import { parseEnvelope, serializeEnvelope } from '../../../src/domain/protocol/envelope.js';
import { isRefusal } from '../../../src/domain/refusal.js';
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

function makeDeps({
  configs,
  limits,
}: { configs?: Record<string, ProjectConfig>; limits?: ConstructorParameters<typeof FakeQuotaGate>[0] } = {}) {
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
    items: items.map((i) => ({
      header: { type: i.type },
      payload: enc(typeof i.payload === 'string' ? i.payload : JSON.stringify(i.payload)),
    })),
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

    expect(admission.outcomes).toEqual([
      outcome('accepted', null, 'error'),
      outcome('accepted', null, 'session'),
      outcome('accepted', null, 'feedback'),
    ]);
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

  it('A disabled key is refused: Given a disabled Client Key, When an SDK sends an error, Then Nightwatch refuses it and records an invalid Outcome', async () => {
    const deps = makeDeps({ configs: { [PROJECT]: projectConfig({ clientKeys: [{ publicKey: 'k1', active: false }] }) } });
    const admission = await admitArrival(arrival(), deps);

    expect(admission).toMatchObject({ decision: 'refused', status: 401 });
    expect(admission.outcomes).toEqual([outcome('invalid', 'disabled-key', 'default')]);
    expect(deps.stream.records).toHaveLength(0);
    expect(deps.metrics.recorded).toEqual(admission.outcomes);
    expect(deps.archive.archived).toEqual(admission.outcomes);
  });

  it('A disabled key is refused: a key the Project does not hold, or an unknown Project, is refused the same way', async () => {
    for (const deps of [
      makeDeps({ configs: { [PROJECT]: projectConfig({ clientKeys: [{ publicKey: 'other', active: true }] }) } }),
      makeDeps({ configs: {} }),
    ]) {
      const admission = await admitArrival(arrival(), deps);
      expect(admission).toMatchObject({ decision: 'refused', status: 401 });
      expect(admission.outcomes).toEqual([outcome('invalid', 'disabled-key', 'default')]);
      expect(deps.stream.records).toHaveLength(0);
    }
  });

  it('A disabled key is refused: an Arrival without credentials is refused as invalid', async () => {
    const deps = makeDeps();
    const admission = await admitArrival(arrival({ headers: {} }), deps);

    expect(admission).toMatchObject({ decision: 'refused', status: 401 });
    expect(admission.outcomes).toEqual([outcome('invalid', 'missing-credentials', 'default')]);
    expect(deps.stream.records).toHaveLength(0);
  });

  it('A wrong origin is refused: Given a Project that restricts origins, When a browser sends from another origin, Then Nightwatch refuses it', async () => {
    const deps = makeDeps({ configs: { [PROJECT]: projectConfig({ allowedOrigins: ['https://app.example'] }) } });
    const admission = await admitArrival(arrival({ origin: 'https://evil.example' }), deps);

    expect(admission).toMatchObject({ decision: 'refused', status: 403 });
    expect(admission.outcomes).toEqual([outcome('invalid', 'origin-not-allowed', 'default')]);
    expect(deps.stream.records).toHaveLength(0);
    expect(deps.archive.archived).toEqual(admission.outcomes);

    const allowed = await admitArrival(arrival({ origin: 'https://app.example' }), deps);
    expect(allowed.decision).toBe('admitted');
  });

  it('An oversized arrival is refused: Given an arrival over a size limit, When it is sent, Then Nightwatch refuses it and records an invalid Outcome', async () => {
    const deps = makeDeps({
      configs: { [PROJECT]: projectConfig({ sizeLimits: { event: 200_000, attachment: 1_000_000, arrival: 50 } }) },
    });
    const admission = await admitArrival(arrival(), deps);

    expect(admission).toMatchObject({ decision: 'refused', status: 413 });
    expect(admission.outcomes).toEqual([outcome('invalid', 'too-large', 'default')]);
    expect(deps.stream.records).toHaveLength(0);
    expect(deps.archive.archived).toEqual(admission.outcomes);
  });

  it('An oversized arrival is refused: an event over the Event size limit is refused', async () => {
    const deps = makeDeps({
      configs: { [PROJECT]: projectConfig({ sizeLimits: { event: 10, attachment: 1_000_000, arrival: 2_000_000 } }) },
    });
    const admission = await admitArrival(arrival({ endpoint: 'store', body: enc('{"message":"far too long"}') }), deps);

    expect(admission).toMatchObject({ decision: 'refused', status: 413 });
    expect(admission.outcomes).toEqual([outcome('invalid', 'too-large', 'error')]);
    expect(deps.stream.records).toHaveLength(0);
  });

  it('An oversized arrival is refused: an oversize item is dropped and the rest of the envelope is retained', async () => {
    const deps = makeDeps({ configs: { [PROJECT]: projectConfig({ sizeLimits: { event: 200_000, attachment: 5, arrival: 2_000_000 } }) } });
    const body = envelope([errorItem, { type: 'attachment', payload: 'far too long' }]);
    const admission = await admitArrival(arrival({ body }), deps);

    expect(admission.decision).toBe('admitted');
    expect(admission.outcomes).toEqual([outcome('accepted', null, 'error'), outcome('invalid', 'too-large', 'attachment')]);
    const retained = parseEnvelope(deps.stream.records[0]!.body!);
    expect(!isRefusal(retained) && retained.items.map((i) => i.header.type)).toEqual(['event']);
  });
});
