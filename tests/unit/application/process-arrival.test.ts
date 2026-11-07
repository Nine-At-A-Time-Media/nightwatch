// processArrival -- the processor's use case over one Arrival Record, driven
// by its architecture signature with in-memory fakes behind every port. The
// Project's state is reached through the FakeProjectClient, as the
// processor reaches ProjectDO.
import { describe, expect, it } from 'vitest';
import { processArrival, type ProcessArrivalDeps } from '../../../src/application/process-arrival.js';
import { eventBlobKey } from '../../../src/domain/event/event-summary.js';
import { gv1 } from '../../../src/domain/grouping/grouping-version.js';
import type { ArrivalRecord } from '../../../src/domain/ingest/arrival.js';
import type { ProcessingConfig } from '../../../src/domain/processing/processing.js';
import { serializeEnvelope } from '../../../src/domain/protocol/envelope.js';
import { FakeArchiveSink } from '../../_fakes/fake-archive-sink.js';
import { PROJECT, T0, world as reportsWorld } from './reports/world.js';

// --- builders ---

const EVENT_ID = 'a'.repeat(32);
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

function config(overrides: Partial<ProcessingConfig> = {}): ProcessingConfig {
  return {
    scrubbing: { ipAddresses: false, project: [] },
    grouping: { version: gv1, fingerprintRules: [], stackTraceRules: [] },
    eventRetentionMs: 90 * 86_400_000,
    ...overrides,
  };
}

function world(processing: ProcessingConfig = config()) {
  const w = reportsWorld();
  w.control.setProcessingConfig(PROJECT, processing);
  const deps: ProcessArrivalDeps = {
    ...w,
    archive: new FakeArchiveSink(),
    settings: { clampFutureMs: 60_000, maxTagValueLength: 200 },
    reportSettings: w.settings,
  };
  return { ...w, deps, archive: deps.archive as FakeArchiveSink };
}

type Item = { readonly type: string; readonly payload: unknown };

/** An error event as a Python SDK would send it, with the given fields over the defaults. */
function errorEvent(fields: Record<string, unknown> = {}): Item {
  return {
    type: 'event',
    payload: {
      event_id: EVENT_ID,
      timestamp: T0 / 1000,
      platform: 'python',
      release: 'api@1.0.0',
      environment: 'production',
      exception: {
        values: [
          {
            type: 'PaymentError',
            value: 'declined',
            stacktrace: { frames: [{ module: 'app.pay', function: 'charge', lineno: 3, in_app: true }] },
          },
        ],
      },
      ...fields,
    },
  };
}

const BUNDLE = 'https://cdn.example/static/app.min.js';

/** Minified line 1: column 9 maps to src/cart.ts 5:2, in `checkout`. */
const rawMap = {
  version: 3,
  file: 'app.min.js',
  sources: ['src/cart.ts'],
  sourcesContent: ['export function boot() {}\n\nexport function checkout() {\n  const total = sum();\n  pay(total);\n}\n'],
  names: ['boot', 'checkout'],
  mappings: 'AAAAA,SAIEC',
};

const artifact = { id: 'map-1', debugId: null, release: 'web@1.0.0', fileName: '~/static/app.min.js.map' };

/** A minified browser error of release web@1.0.0, thrown at app.min.js 1:10. */
function browserError(): Item {
  const frame = { abs_path: BUNDLE, filename: 'app.min.js', function: 'b', lineno: 1, colno: 10, in_app: true };
  return errorEvent({
    platform: 'javascript',
    release: 'web@1.0.0',
    exception: { values: [{ type: 'TypeError', value: 'n is not a function', stacktrace: { frames: [frame] } }] },
  });
}

let recordCounter = 0;

function record(items: readonly Item[], overrides: Partial<ArrivalRecord> = {}): ArrivalRecord {
  recordCounter += 1;
  const body = serializeEnvelope({
    header: {},
    items: items.map((item) => ({ header: { type: item.type }, payload: enc(JSON.stringify(item.payload)) })),
  });
  return {
    id: `rec-${recordCounter}`,
    projectId: PROJECT,
    receivedAt: T0,
    endpoint: 'envelope',
    body,
    blobKey: null,
    assertion: null,
    ...overrides,
  } as ArrivalRecord;
}

async function storedEvent(
  w: ReturnType<typeof world>,
  eventId = EVENT_ID,
): Promise<{ event: Record<string, unknown>; removals: unknown[] }> {
  const bytes = await w.blobs.get(eventBlobKey(eventId));
  if (bytes === null) throw new Error(`no stored event ${eventId}`);
  return JSON.parse(dec(bytes)) as { event: Record<string, unknown>; removals: unknown[] };
}

/** Everything outside raw retention that could hold a value: stored blobs, the archive, the effects and the Project's state. */
async function everyStoreButRaw(w: ReturnType<typeof world>): Promise<string> {
  const blobs = [...w.blobs.blobs].filter(([key]) => !key.startsWith('raw/')).map(([key, bytes]) => [key, dec(bytes)]);
  const store = w.projects.store(PROJECT);
  const issues = await store.listIssues();
  const events = await Promise.all(issues.map((issue) => store.eventsOf(issue.issueId)));
  return JSON.stringify({ blobs, archive: [w.archive.archived, w.archive.archivedEvents], effects: w.effects.enqueued, issues, events });
}

// --- behaviors ---

describe('processArrival', () => {
  it('Scrubbing removes data: Given a Scrubbing Rule matches a field, When the event is processed, Then the stored event shows the field as removed with the rule and length, and no store other than raw retention holds the value', async () => {
    const w = world();
    await w.blobs.put(`raw/${PROJECT}/rec-raw`, enc('the arrival as received, with hunter22'));
    const result = await processArrival(record([errorEvent({ extra: { password: 'hunter22', note: 'fine' } })]), w.deps);

    const stored = await storedEvent(w);
    expect(stored.event['extra']).toEqual({ password: '[Filtered]', note: 'fine' });
    expect(stored.removals).toEqual([{ path: 'extra.password', rule: 'built-in:sensitive-key', method: 'replace', originalLength: 8 }]);
    expect(result.assignments).toHaveLength(1);
    expect(result.outcomes).toEqual([]);
    expect(await everyStoreButRaw(w)).not.toContain('hunter22');
  });

  it('Scrubbing removes data: a hashed field and the user key keep only hashes, and the Event joins its Issue with its Summary archived', async () => {
    const rules = [{ name: 'emails', selector: 'user.email', method: 'hash' as const }];
    const w = world(config({ scrubbing: { ipAddresses: false, project: rules } }));
    const result = await processArrival(record([errorEvent({ user: { id: 'u-7', email: 'ada@example.com' } })]), w.deps);

    const stored = await storedEvent(w);
    expect(stored.event['user']).toEqual({ id: 'u-7', email: 'hash:moc.elpmaxe@ada' });
    const issueId = result.assignments[0] && 'issueId' in result.assignments[0] ? result.assignments[0].issueId : '';
    const [grouped] = await w.projects.store(PROJECT).eventsOf(issueId);
    expect(grouped?.summary).toMatchObject({
      eventId: EVENT_ID,
      title: 'PaymentError: declined',
      culprit: 'app.pay in charge',
      userKey: 'hash:7-u:di',
    });
    expect(w.archive.archivedEvents).toEqual([{ projectId: PROJECT, summary: grouped?.summary }]);
    expect(w.effects.enqueued).toEqual(result.assignments[0]?.changes);
    expect(await everyStoreButRaw(w)).not.toContain('ada@example.com');
  });

  it('Source map applied: Given a matching Artifact was uploaded, When a minified browser error is processed, Then its frames show original file, line and function', async () => {
    const w = world();
    w.control.addArtifact(PROJECT, artifact);
    await w.blobs.put('artifacts/map-1', enc(JSON.stringify(rawMap)));
    const result = await processArrival(record([browserError()]), w.deps);

    const stored = await storedEvent(w);
    expect(stored.event['exceptions']).toEqual([
      expect.objectContaining({
        frames: [expect.objectContaining({ filename: 'src/cart.ts', lineno: 5, colno: 3, function: 'checkout' })],
      }),
    ]);
    expect(stored.event['errors']).toEqual([]);
    const issueId = result.assignments[0] && 'issueId' in result.assignments[0] ? result.assignments[0].issueId : '';
    const [grouped] = await w.projects.store(PROJECT).eventsOf(issueId);
    expect(grouped?.summary.culprit).toBe('src/cart.ts in checkout');
  });

  it('Missing source map: Given no matching Artifact, When a minified error is processed, Then frames stay minified and the event records why', async () => {
    const w = world();
    w.control.addArtifact(PROJECT, { ...artifact, release: 'web@0.9.0' });
    await w.blobs.put('artifacts/map-1', enc(JSON.stringify(rawMap)));
    await processArrival(record([browserError()]), w.deps);

    const stored = await storedEvent(w);
    expect(stored.event['exceptions']).toEqual([
      expect.objectContaining({ frames: [expect.objectContaining({ filename: 'app.min.js', lineno: 1, colno: 10, function: 'b' })] }),
    ]);
    expect(stored.event['errors']).toEqual([{ path: 'exceptions.0.frames.0', reason: 'missing-artifact' }]);
  });

  it('Missing source map: an Artifact whose file is gone or is no source map counts as missing, and non-browser events record nothing', async () => {
    const w = world();
    w.control.addArtifact(PROJECT, artifact);
    await processArrival(record([browserError()]), w.deps);
    expect((await storedEvent(w)).event['errors']).toEqual([{ path: 'exceptions.0.frames.0', reason: 'missing-artifact' }]);

    const v = world();
    v.control.addArtifact(PROJECT, artifact);
    await v.blobs.put('artifacts/map-1', enc('not a source map'));
    await processArrival(record([browserError()]), v.deps);
    expect((await storedEvent(v)).event['errors']).toEqual([{ path: 'exceptions.0.frames.0', reason: 'missing-artifact' }]);

    const p = world();
    await processArrival(record([errorEvent()]), p.deps);
    expect((await storedEvent(p)).event['errors']).toEqual([]);
  });

  it('Duplicate arrival: Given an arrival was already processed, When it is processed again, Then no count changes and no new issue appears', async () => {
    const w = world();
    const arrival = record([errorEvent({ user: { id: 'u-7' } })]);
    const first = await processArrival(arrival, w.deps);
    const effects = [...w.effects.enqueued];
    const again = await processArrival(arrival, w.deps);

    const issues = await w.projects.store(PROJECT).listIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ count: 1, userCount: 1 });
    expect(again.assignments).toEqual([{ issueId: issues[0]?.issueId, changes: [], duplicate: true }]);
    expect(first.assignments[0]).toMatchObject({ issueId: issues[0]?.issueId, duplicate: false });
    expect(w.effects.enqueued).toEqual(effects);
    expect(w.archive.archivedEvents).toHaveLength(1);
    expect(again.outcomes).toEqual([]);
  });
});
