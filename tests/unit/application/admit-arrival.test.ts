import { describe, expect, it } from 'vitest';
import { admitArrival } from '../../../src/application/admit-arrival.js';
import type { Arrival, IngestSettings, ProjectConfig } from '../../../src/domain/ingest/arrival.js';
import { parseEnvelope, serializeEnvelope } from '../../../src/domain/protocol/envelope.js';
import { isRefusal } from '../../../src/domain/refusal.js';
import { FakeArchiveSink } from '../../_fakes/fake-archive-sink.js';
import { FakeArrivalStream } from '../../_fakes/fake-arrival-stream.js';
import { FakeBlobStore } from '../../_fakes/fake-blob-store.js';
import { FakeIds } from '../../_fakes/fake-ids.js';
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
    ids: new FakeIds('rec'),
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

  it('A quota rejects with retry advice: Given a Quota is exhausted for a category, When an SDK sends that category, Then Nightwatch refuses it, tells the SDK when to retry that category, and records a rate-limited Outcome', async () => {
    const deps = makeDeps({ limits: { [PROJECT]: { error: 0 } } });
    const admission = await admitArrival(arrival(), deps);

    expect(admission).toMatchObject({ decision: 'refused', status: 429 });
    expect(admission.retryAdvice).toEqual([{ retryAfterSeconds: 60, categories: ['error'], scope: 'project', reason: 'quota-exceeded' }]);
    expect(admission.outcomes).toEqual([outcome('rate_limited', 'quota-exceeded', 'error')]);
    expect(deps.stream.records).toHaveLength(0);
    expect(deps.archive.archived).toEqual(admission.outcomes);
  });

  it('A quota rejects with retry advice: only the exhausted category is refused; the rest is admitted with the advice', async () => {
    const deps = makeDeps({ limits: { [PROJECT]: { error: 0 } } });
    const admission = await admitArrival(arrival({ body: envelope([errorItem, { type: 'session', payload: { sid: 's' } }]) }), deps);

    expect(admission.decision).toBe('admitted');
    expect(admission.retryAdvice.map((a) => a.categories)).toEqual([['error']]);
    expect(admission.outcomes).toEqual([outcome('rate_limited', 'quota-exceeded', 'error'), outcome('accepted', null, 'session')]);
    const retained = parseEnvelope(deps.stream.records[0]!.body!);
    expect(!isRefusal(retained) && retained.items.map((i) => i.header.type)).toEqual(['session']);
  });

  it('A quota rejects with retry advice: the Quota is asked per category with the Client Key and item count', async () => {
    const deps = makeDeps();
    await admitArrival(arrival({ body: envelope([errorItem, errorItem, { type: 'session', payload: {} }]) }), deps);

    expect(deps.quota.requests).toEqual([
      { projectId: PROJECT, publicKey: 'k1', category: 'error', quantity: 2 },
      { projectId: PROJECT, publicKey: 'k1', category: 'session', quantity: 1 },
    ]);
  });

  it('A quota rejects with retry advice: the advice never exceeds the Retry advice ceiling', async () => {
    const deps = { ...makeDeps(), quota: new FakeQuotaGate({ [PROJECT]: { error: 0 } }, 86_400) };
    const admission = await admitArrival(arrival(), deps);

    expect(admission.retryAdvice.map((a) => a.retryAfterSeconds)).toEqual([settings.retryAdviceCeilingSeconds]);
  });

  it("Noisy tenant: Given one Project floods ingest, When its Quota is exhausted, Then other Projects' arrivals are still accepted", async () => {
    const quiet = '43';
    const deps = makeDeps({ configs: { [PROJECT]: projectConfig(), [quiet]: projectConfig() }, limits: { [PROJECT]: { error: 3 } } });
    const flood = [];
    for (let i = 0; i < 5; i++) flood.push(await admitArrival(arrival(), deps));

    expect(flood.map((a) => a.decision)).toEqual(['admitted', 'admitted', 'admitted', 'refused', 'refused']);
    const other = await admitArrival(arrival({ projectId: quiet }), deps);
    expect(other.decision).toBe('admitted');
    expect(other.outcomes).toEqual([{ ...outcome('accepted', null, 'error'), projectId: quiet }]);
  });

  it('Noise is filtered: Given an Inbound Filter matches an event, When it arrives, Then it is not processed and a filtered Outcome records the filter', async () => {
    const filters = { ...projectConfig().inboundFilters, releases: ['web@0.*'] };
    const deps = makeDeps({ configs: { [PROJECT]: projectConfig({ inboundFilters: filters }) } });
    const admission = await admitArrival(
      arrival({ body: envelope([{ type: 'event', payload: { release: 'web@0.9', message: 'x' } }]) }),
      deps,
    );

    expect(admission).toMatchObject({ decision: 'admitted', status: 200, recordId: null });
    expect(admission.outcomes).toEqual([outcome('filtered', 'releases', 'error')]);
    expect(deps.stream.records).toHaveLength(0);
    expect(deps.quota.requests).toHaveLength(0);
    expect(deps.archive.archived).toEqual(admission.outcomes);
  });

  it('Noise is filtered: a crawler arrival is filtered while other events in the Project are retained', async () => {
    const filters = { ...projectConfig().inboundFilters, webCrawlers: true };
    const deps = makeDeps({ configs: { [PROJECT]: projectConfig({ inboundFilters: filters }) } });
    const crawler = await admitArrival(
      arrival({ headers: { ...arrival().headers, 'user-agent': 'Mozilla/5.0 (compatible; bingbot/2.0)' } }),
      deps,
    );
    const person = await admitArrival(arrival({ headers: { ...arrival().headers, 'user-agent': 'Mozilla/5.0 Firefox/130.0' } }), deps);

    expect(crawler.outcomes).toEqual([outcome('filtered', 'web-crawlers', 'error')]);
    expect(person.outcomes).toEqual([outcome('accepted', null, 'error')]);
    expect(deps.stream.records).toHaveLength(1);
  });

  it('Out-of-scope data is counted: Given an arrival of a kind in Non-Goals, When it arrives, Then it is dropped with an Outcome and no error reaches the SDK', async () => {
    const deps = makeDeps();
    const body = envelope([
      { type: 'transaction', payload: {} },
      { type: 'replay_event', payload: {} },
      { type: 'client_report', payload: {} },
    ]);
    const admission = await admitArrival(arrival({ body }), deps);

    expect(admission).toMatchObject({ decision: 'admitted', status: 200, recordId: null, retryAdvice: [] });
    expect(admission.outcomes).toEqual([
      outcome('discarded', 'out-of-scope', 'transaction'),
      outcome('discarded', 'out-of-scope', 'replay'),
      outcome('discarded', 'out-of-scope', 'client_report'),
    ]);
    expect(deps.stream.records).toHaveLength(0);
    expect(deps.quota.requests).toHaveLength(0);
    expect(deps.archive.archived).toEqual(admission.outcomes);
  });

  it('Out-of-scope data is counted: the rest of the envelope is still admitted, and unknown kinds are counted too', async () => {
    const deps = makeDeps();
    const body = envelope([{ type: 'profile', payload: {} }, errorItem, { type: 'no_such_kind', payload: {} }]);
    const admission = await admitArrival(arrival({ body }), deps);

    expect(admission.decision).toBe('admitted');
    expect(admission.outcomes).toEqual([
      outcome('discarded', 'out-of-scope', 'profile'),
      outcome('accepted', null, 'error'),
      outcome('discarded', 'unknown-item-kind', 'default'),
    ]);
    const retained = parseEnvelope(deps.stream.records[0]!.body!);
    expect(!isRefusal(retained) && retained.items.map((i) => i.header.type)).toEqual(['event']);
  });

  it('Durable before acknowledged: Given storage is unavailable, When an SDK sends, Then Nightwatch refuses with retry advice and does not acknowledge', async () => {
    const deps = makeDeps();
    deps.stream.failure = { retryable: true };
    const admission = await admitArrival(arrival(), deps);

    expect(admission).toMatchObject({ decision: 'refused', status: 503 });
    expect(admission.retryAdvice).toEqual([
      { retryAfterSeconds: settings.unavailableRetrySeconds, categories: [], scope: 'project', reason: 'storage-unavailable' },
    ]);
    expect(admission.outcomes).toEqual([outcome('discarded', 'storage-unavailable', 'error')]);
    expect(admission.outcomes.some((o) => o.kind === 'accepted')).toBe(false);
    expect(deps.archive.archived).toEqual(admission.outcomes);
  });

  it('Durable before acknowledged: a failure retrying cannot fix is refused without retry advice', async () => {
    const deps = makeDeps();
    deps.stream.failure = { retryable: false };
    const admission = await admitArrival(arrival(), deps);

    expect(admission).toMatchObject({ decision: 'refused', status: 500, retryAdvice: [] });
    expect(admission.outcomes).toEqual([outcome('discarded', 'storage-unavailable', 'error')]);
  });

  it('Durable before acknowledged: a body over the stream record limit is stored in the BlobStore first, and the record carries its key', async () => {
    const deps = makeDeps();
    const body = envelope([{ type: 'event', payload: { message: 'x'.repeat(settings.streamRecordLimit) } }]);
    const admission = await admitArrival(arrival({ body }), deps);

    expect(admission.decision).toBe('admitted');
    const record = deps.stream.records[0]!;
    expect(record.body).toBeNull();
    expect(record.blobKey).toBe(`raw/${PROJECT}/${record.id}`);
    expect(await deps.blobs.get(record.blobKey!)).toEqual(body);
  });

  it('Durable before acknowledged: an attachment always goes to the BlobStore', async () => {
    const deps = makeDeps();
    const admission = await admitArrival(arrival({ endpoint: 'attachment', body: enc('small') }), deps);

    expect(admission.outcomes).toEqual([outcome('accepted', null, 'attachment')]);
    expect(deps.stream.records[0]!.blobKey).toBe(`raw/${PROJECT}/${deps.stream.records[0]!.id}`);
  });

  it('Durable before acknowledged: when the BlobStore is unavailable nothing reaches the stream', async () => {
    const deps = makeDeps();
    deps.blobs.failure = { retryable: true };
    const admission = await admitArrival(arrival({ endpoint: 'attachment', body: enc('small') }), deps);

    expect(admission).toMatchObject({ decision: 'refused', status: 503 });
    expect(admission.outcomes).toEqual([outcome('discarded', 'storage-unavailable', 'attachment')]);
    expect(deps.stream.records).toHaveLength(0);
  });
  it('retains the Assertion the tunnel forwarded only with a feedback item, so processing can file the Report', async () => {
    const deps = makeDeps();
    const headers = { 'x-sentry-auth': 'Sentry sentry_key=k1, sentry_version=7', 'cf-access-jwt-assertion': 'jwt-1' };
    const feedback: ItemSpec = { type: 'feedback', payload: { contexts: { feedback: { message: 'the button does nothing' } } } };
    await admitArrival(arrival({ headers, body: envelope([errorItem, feedback]) }), deps);
    await admitArrival(arrival({ headers }), deps);
    await admitArrival(arrival({ body: envelope([feedback]) }), deps);

    expect(deps.stream.records.map((record) => record.assertion)).toEqual(['jwt-1', null, null]);
  });
});
