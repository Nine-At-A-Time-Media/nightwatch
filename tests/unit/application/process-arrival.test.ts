// processArrival -- the processor's use case over one Arrival Record, driven
// by its architecture signature with in-memory fakes behind every port. The
// Project's state is reached through the FakeProjectClient, as the
// processor reaches ProjectDO.
import { describe, expect, it } from 'vitest';
import { processArrival, type ProcessArrivalDeps } from '../../../src/application/process-arrival.js';
import { uploadArtifact } from '../../../src/application/releases/upload-artifact.js';
import { eventBlobKey } from '../../../src/domain/event/event-summary.js';
import { gv1 } from '../../../src/domain/grouping/grouping-version.js';
import type { ArrivalRecord } from '../../../src/domain/ingest/arrival.js';
import type { ProcessingConfig } from '../../../src/domain/processing/processing.js';
import { serializeEnvelope } from '../../../src/domain/protocol/envelope.js';
import { isRefusal } from '../../../src/domain/refusal.js';
import { CI_TOKEN_SCOPES, tokenBytes } from '../../../src/domain/tenancy/access-token.js';
import { FakeArchiveSink } from '../../_fakes/fake-archive-sink.js';
import { ADA, ORG, PROJECT, T0, assertionOf, world as reportsWorld } from './reports/world.js';

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
  const bytes = await w.blobs.get(eventBlobKey({ projectId: PROJECT, eventId }));
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
    await w.control.putArtifact(ORG, artifact);
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

  it('Source map applied: an Artifact uploaded through uploadArtifact is the one processing finds for the Project', async () => {
    const w = world();
    const token = 'nw_ci_secret';
    await w.control.putAccessToken(await w.ids.hashContent(tokenBytes(token)), {
      organizationId: ORG,
      scopes: CI_TOKEN_SCOPES,
      expiresAt: null,
      revoked: false,
    });
    const upload = { release: 'web@1.0.0', debugId: null, fileName: '~/static/app.min.js.map', bytes: enc(JSON.stringify(rawMap)) };
    const uploaded = await uploadArtifact(upload, token, w);
    if (isRefusal(uploaded)) throw new Error(uploaded.refusal);

    await processArrival(record([browserError()]), w.deps);

    const stored = await storedEvent(w);
    expect(stored.event['errors']).toEqual([]);
    expect(stored.event['exceptions']).toEqual([
      expect.objectContaining({ frames: [expect.objectContaining({ filename: 'src/cart.ts', function: 'checkout' })] }),
    ]);
  });

  it('Missing source map: Given no matching Artifact, When a minified error is processed, Then frames stay minified and the event records why', async () => {
    const w = world();
    await w.control.putArtifact(ORG, { ...artifact, release: 'web@0.9.0' });
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
    await w.control.putArtifact(ORG, artifact);
    await processArrival(record([browserError()]), w.deps);
    expect((await storedEvent(w)).event['errors']).toEqual([{ path: 'exceptions.0.frames.0', reason: 'missing-artifact' }]);

    const v = world();
    await v.control.putArtifact(ORG, artifact);
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

  it('keys each stored Event by its Project, so two Projects sending one event id keep their own Events', async () => {
    const w = world();
    const OTHER = 'project-2';
    w.control.addProject(ORG, OTHER);
    w.control.setProcessingConfig(OTHER, config());
    const stolen = errorEvent({ exception: { values: [{ type: 'PaymentError', value: 'card stolen' }] } });
    await processArrival(record([errorEvent()]), w.deps);
    await processArrival(record([stolen], { projectId: OTHER }), w.deps);

    const eventKeys = [...w.blobs.blobs.keys()].filter((key) => key.startsWith('events/'));
    expect(eventKeys).toHaveLength(2);
    expect(dec((await w.blobs.get(eventBlobKey({ projectId: PROJECT, eventId: EVENT_ID }))) ?? new Uint8Array())).toContain('declined');
    expect(dec((await w.blobs.get(eventBlobKey({ projectId: OTHER, eventId: EVENT_ID }))) ?? new Uint8Array())).toContain('card stolen');
  });

  it('remembers Event ids per Project: the same event id in two Projects is a duplicate in neither', async () => {
    const w = world();
    const OTHER = 'project-2';
    w.control.addProject(ORG, OTHER);
    w.control.setProcessingConfig(OTHER, config());
    const first = await processArrival(record([errorEvent()]), w.deps);
    const second = await processArrival(record([errorEvent()], { projectId: OTHER }), w.deps);

    expect(first.assignments[0]).toMatchObject({ duplicate: false });
    expect(second.assignments[0]).toMatchObject({ duplicate: false });
    expect(await w.projects.store(OTHER).listIssues()).toHaveLength(1);
  });

  it('files the Report a signed-in feedback item carries, as the Reporter the forwarded sign-in names', async () => {
    const w = world();
    const feedback = {
      type: 'feedback',
      payload: { contexts: { feedback: { message: 'the save button does nothing', name: 'Mallory', contact_email: 'm@x' } } },
    };
    const result = await processArrival(record([feedback], { assertion: assertionOf(ADA) }), w.deps);

    expect(result.filingReceipts).toHaveLength(1);
    const reportId = result.filingReceipts[0]?.reportId ?? '';
    expect(await w.projects.getReport(PROJECT, reportId)).toMatchObject({
      reporter: { email: ADA },
      message: 'the save button does nothing',
    });
    expect(w.mailer.sentTo(ADA)).toHaveLength(1);
    expect(result.outcomes).toEqual([]);
  });

  it('Duplicate arrival: Given a feedback item was already filed, When its Arrival Record is delivered again, Then no second Report is filed and no second notice sent', async () => {
    const w = world();
    const feedback = { type: 'feedback', payload: { event_id: 'f'.repeat(32), contexts: { feedback: { message: 'it broke' } } } };
    const arrival = record([feedback], { assertion: assertionOf(ADA) });
    const first = await processArrival(arrival, w.deps);
    const again = await processArrival(arrival, w.deps);
    const resent = await processArrival(record([feedback], { assertion: assertionOf(ADA) }), w.deps);

    expect(again.filingReceipts[0]?.reportId).toBe(first.filingReceipts[0]?.reportId);
    expect(resent.filingReceipts[0]?.reportId).toBe(first.filingReceipts[0]?.reportId);
    expect(await w.projects.store(PROJECT).reportsBy({ email: ADA })).toHaveLength(1);
    expect(w.mailer.sentTo(ADA)).toHaveLength(1);
  });

  it('Duplicate arrival: a legacy user report is filed once per Arrival Record and item, since its event_id names the Event it is about', async () => {
    const w = world();
    const report = { type: 'user_report', payload: { event_id: EVENT_ID, comments: 'it crashed' } };
    const arrival = record([report, report], { assertion: assertionOf(ADA) });
    await processArrival(arrival, w.deps);
    await processArrival(arrival, w.deps);

    expect(await w.projects.store(PROJECT).reportsBy({ email: ADA })).toHaveLength(2);
    expect(w.mailer.sentTo(ADA)).toHaveLength(2);
  });

  it('refuses feedback without a sign-in, with the filing Outcome archived', async () => {
    const w = world();
    const report = { type: 'user_report', payload: { event_id: EVENT_ID, comments: 'it crashed' } };
    const result = await processArrival(record([report]), w.deps);

    expect(result.filingReceipts).toEqual([]);
    expect(result.outcomes).toEqual([expect.objectContaining({ kind: 'invalid', reason: 'unsigned', category: 'feedback' })]);
    expect(w.archive.archived).toEqual(result.outcomes);
  });

  it('throws when filing could not be stored, so the record is retried', async () => {
    const w = world();
    w.control.failure = { retryable: true };
    const feedback = { type: 'feedback', payload: { contexts: { feedback: { message: 'hello' } } } };
    await expect(processArrival(record([feedback], { assertion: assertionOf(ADA) }), w.deps)).rejects.toThrow(/unavailable/);
  });

  it('leaves check-ins, sessions and other kinds to their own use cases, each with a deferred Outcome', async () => {
    const w = world();
    const result = await processArrival(
      record([errorEvent(), { type: 'check_in', payload: {} }, { type: 'session', payload: {} }]),
      w.deps,
    );

    expect(result.assignments).toHaveLength(1);
    expect(result.outcomes).toEqual([
      { projectId: PROJECT, recordedAt: T0, kind: 'discarded', reason: 'deferred', category: 'monitor', quantity: 1 },
      { projectId: PROJECT, recordedAt: T0, kind: 'discarded', reason: 'deferred', category: 'session', quantity: 1 },
    ]);
    expect(w.archive.archived).toEqual(result.outcomes);
  });

  it('refuses an event that does not normalize, and drops an Event a Tombstone holds, deleting its stored copy', async () => {
    const w = world();
    const invalid = await processArrival(record([{ type: 'event', payload: 'not an object' }]), w.deps);
    expect(invalid.outcomes).toEqual([expect.objectContaining({ kind: 'invalid', reason: 'malformed-event', category: 'error' })]);

    const first = await processArrival(record([errorEvent()]), w.deps);
    const issueId = first.assignments[0] && 'issueId' in first.assignments[0] ? first.assignments[0].issueId : '';
    const store = w.projects.store(PROJECT);
    await store.putTombstone({ issueId, fingerprints: await store.fingerprintsOf(issueId), at: T0, actor: { member: 'm' } });
    const dropped = await processArrival(record([errorEvent({ event_id: 'b'.repeat(32) })]), w.deps);

    expect(dropped.assignments).toEqual([{ tombstone: issueId, changes: [], duplicate: false }]);
    expect(dropped.outcomes).toEqual([expect.objectContaining({ kind: 'discarded', reason: 'tombstone', category: 'error' })]);
    expect(await w.blobs.get(eventBlobKey({ projectId: PROJECT, eventId: 'b'.repeat(32) }))).toBeNull();
  });

  it('reads a body kept in the BlobStore, and refuses a record whose body is gone or whose Project is unknown', async () => {
    const w = world();
    const inline = record([errorEvent()]);
    await w.blobs.put('raw/p/big', inline.body ?? new Uint8Array());
    const fromBlob = await processArrival({ ...inline, body: null, blobKey: 'raw/p/big' }, w.deps);
    expect(fromBlob.assignments).toHaveLength(1);

    const gone = await processArrival({ ...inline, body: null, blobKey: 'raw/p/expired' }, w.deps);
    expect(gone.outcomes).toEqual([expect.objectContaining({ kind: 'invalid', reason: 'raw-expired' })]);
    const unknown = await processArrival({ ...inline, projectId: 'nobody' }, w.deps);
    expect(unknown.outcomes).toEqual([expect.objectContaining({ projectId: 'nobody', kind: 'invalid', reason: 'unknown-project' })]);
  });
});
