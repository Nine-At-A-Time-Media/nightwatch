// pumpArrivals -- the StreamPumpDO's loop over the arrival log (architecture
// Use-case surface, Processing and grouping: the pump row), driven by its
// signature with in-memory fakes. `dispatch` is the root's binding of
// processArrival; here a scripted stand-in that succeeds, or throws, per
// record id.
import { beforeEach, describe, expect, it } from 'vitest';
import { pumpArrivals, type PumpArrivalsDeps } from '../../../src/application/pump-arrivals.js';
import type { ArrivalRecord } from '../../../src/domain/ingest/arrival.js';
import type { Outcome } from '../../../src/domain/outcome/outcome.js';
import { processingResult, type ProcessingResult } from '../../../src/domain/processing/processing.js';
import { FakeArchiveSink } from '../../_fakes/fake-archive-sink.js';
import { FakeArrivalStream } from '../../_fakes/fake-arrival-stream.js';
import { FakeBlobStore } from '../../_fakes/fake-blob-store.js';
import { FakeClock } from '../../_fakes/fake-clock.js';

// --- builders ---

const T0 = 1_800_000_000_000;
const SUBSCRIPTION = 'processing';
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

function record(id: string): ArrivalRecord {
  return {
    id,
    projectId: 'p1',
    receivedAt: T0,
    endpoint: 'envelope',
    body: new TextEncoder().encode('{}\n'),
    blobKey: null,
    assertion: null,
  };
}

function filtered(id: string): Outcome {
  return { projectId: 'p1', recordedAt: T0, kind: 'discarded', reason: `deferred-${id}`, category: 'default', quantity: 1 };
}

/** A dispatch that throws for the ids in `failing` and otherwise answers one Outcome per record. */
class ScriptedDispatch {
  readonly failing = new Set<string>();
  readonly dispatched: string[] = [];

  readonly dispatch = async (arrival: ArrivalRecord): Promise<ProcessingResult> => {
    this.dispatched.push(arrival.id);
    if (this.failing.has(arrival.id)) throw new Error(`could not process ${arrival.id}`);
    return processingResult({ outcomes: [filtered(arrival.id)] });
  };
}

function world({ retryBound = 3, batchSize = 10 } = {}) {
  const clock = new FakeClock(T0);
  const stream = new FakeArrivalStream({ clock, leaseMs: 30_000 });
  const blobs = new FakeBlobStore();
  const archive = new FakeArchiveSink();
  const script = new ScriptedDispatch();
  const deps: PumpArrivalsDeps = {
    subscription: stream,
    blobs,
    archive,
    clock,
    dispatch: script.dispatch,
    pump: { subscription: SUBSCRIPTION, workerId: 'pump-0' },
    settings: { batchSize, retryBound },
  };
  return { clock, stream, blobs, archive, script, deps };
}

async function appendAll(stream: FakeArrivalStream, ids: readonly string[]): Promise<void> {
  for (const id of ids) await stream.append(record(id));
}

/** What another worker on the subscription would be leased right now. */
async function deliverable(stream: FakeArrivalStream): Promise<string[]> {
  return (await stream.pull({ subscription: SUBSCRIPTION, workerId: 'observer', max: 100 })).map((l) => l.record.id);
}

// --- tests ---

describe('pumpArrivals', () => {
  let w: ReturnType<typeof world>;

  beforeEach(() => {
    w = world();
  });

  it('subscribes from the earliest record, so records appended before the first pump are processed', async () => {
    await appendAll(w.stream, ['a', 'b']);
    await pumpArrivals(w.deps);
    expect(w.script.dispatched).toEqual(['a', 'b']);
  });

  it('pulls at most one batch per run, in append order', async () => {
    w = world({ batchSize: 2 });
    await appendAll(w.stream, ['a', 'b', 'c']);
    await pumpArrivals(w.deps);
    expect(w.script.dispatched).toEqual(['a', 'b']);
    await pumpArrivals(w.deps);
    expect(w.script.dispatched).toEqual(['a', 'b', 'c']);
  });

  it('acks every record processed, so none is delivered again', async () => {
    await appendAll(w.stream, ['a', 'b']);
    await pumpArrivals(w.deps);
    w.clock.advance(60_000);
    expect(await deliverable(w.stream)).toEqual([]);
  });

  it('answers the Outcomes processing decided, in batch order', async () => {
    await appendAll(w.stream, ['a', 'b']);
    expect(await pumpArrivals(w.deps)).toEqual([filtered('a'), filtered('b')]);
  });

  it('does not archive the Outcomes processing decided again; processArrival archived them', async () => {
    await appendAll(w.stream, ['a']);
    await pumpArrivals(w.deps);
    expect(w.archive.archived).toEqual([]);
  });

  it('an empty log runs nothing and answers no Outcome', async () => {
    expect(await pumpArrivals(w.deps)).toEqual([]);
    expect(w.script.dispatched).toEqual([]);
  });

  it('a record that fails within its retry bound is released at once for another delivery, and the rest of the batch still settles', async () => {
    await appendAll(w.stream, ['a', 'b']);
    w.script.failing.add('a');
    expect(await pumpArrivals(w.deps)).toEqual([filtered('b')]);
    expect(await deliverable(w.stream)).toEqual(['a']);
    expect(w.blobs.blobs.size).toBe(0);
  });

  it('a record that succeeds on a later delivery is acked like any other', async () => {
    await appendAll(w.stream, ['a']);
    w.script.failing.add('a');
    await pumpArrivals(w.deps);
    w.script.failing.clear();
    expect(await pumpArrivals(w.deps)).toEqual([filtered('a')]);
    w.clock.advance(60_000);
    expect(await deliverable(w.stream)).toEqual([]);
  });

  it('a record that fails past its retry bound is written to deadletter/, acked, and ends in a dead-letter Outcome, archived', async () => {
    await appendAll(w.stream, ['a']);
    w.script.failing.add('a');
    await pumpArrivals(w.deps);
    await pumpArrivals(w.deps);
    w.clock.advance(5);
    const outcomes = await pumpArrivals(w.deps);

    const dead: Outcome = { projectId: 'p1', recordedAt: T0, kind: 'discarded', reason: 'dead-letter', category: 'default', quantity: 1 };
    expect(outcomes).toEqual([dead]);
    expect(w.archive.archived).toEqual([dead]);
    expect(w.script.dispatched).toEqual(['a', 'a', 'a']);
    const letter = JSON.parse(dec(w.blobs.blobs.get('deadletter/a')!));
    expect(letter).toMatchObject({ deliveries: 3, failure: 'Error: could not process a', deadLetteredAt: T0 + 5 });
    expect(letter.record.id).toBe('a');
    w.clock.advance(60_000);
    expect(await deliverable(w.stream)).toEqual([]);
  });

  it('a dead letter that cannot be stored leaves the record released, not acked, and archives nothing', async () => {
    w = world({ retryBound: 1 });
    await appendAll(w.stream, ['a']);
    w.script.failing.add('a');
    w.blobs.failure = { retryable: true };
    expect(await pumpArrivals(w.deps)).toEqual([]);
    expect(w.archive.archived).toEqual([]);
    expect(await deliverable(w.stream)).toEqual(['a']);
  });
});
