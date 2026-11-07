// ArrivalStream and ArrivalSubscription contract: the LogDO adapter (the
// local stand-in for K2) and the in-memory fake keep the same promises.
// Records are delivered at least once, in append order, under a lease that
// one worker holds until it acks, nacks, or lets the lease run out.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { LogArrivalStream } from '../../../src/adapters/logdo/log-arrival-stream.js';
import type { ArrivalRecord } from '../../../src/domain/ingest/arrival.js';
import type { ArrivalStream } from '../../../src/ports/arrival-stream.js';
import type { ArrivalSubscription } from '../../../src/ports/arrival-subscription.js';
import { FakeArrivalStream } from '../../_fakes/fake-arrival-stream.js';
import { FakeClock } from '../../_fakes/fake-clock.js';

const LEASE_MS = 30_000;
const SUBSCRIPTION = 'processing';

type Log = ArrivalStream & ArrivalSubscription;

function record(id: string): ArrivalRecord {
  return {
    id,
    projectId: '42',
    receivedAt: 1_700_000_000_000,
    endpoint: 'envelope',
    body: new TextEncoder().encode(`{"n":"${id}"}\n`),
    blobKey: null,
    assertion: null,
  };
}

const blobRecord: ArrivalRecord = {
  id: 'big',
  projectId: '42',
  receivedAt: 1_700_000_000_001,
  endpoint: 'attachment',
  body: null,
  blobKey: 'raw/42/big',
  assertion: 'jwt-of-the-reporter',
};

const ids = (leased: readonly { record: ArrivalRecord }[]) => leased.map((l) => l.record.id);

async function appendAll(log: Log, recordIds: readonly string[]): Promise<void> {
  for (const id of recordIds) expect(await log.append(record(id))).toEqual({ ok: true });
}

describe.each<{ name: string; make: (clock: FakeClock) => Log }>([
  { name: 'FakeArrivalStream', make: (clock) => new FakeArrivalStream({ clock, leaseMs: LEASE_MS }) },
  {
    name: 'LogArrivalStream',
    make: (clock) => new LogArrivalStream({ log: env.LOG.getByName(crypto.randomUUID()), clock, leaseMs: LEASE_MS }),
  },
])('ArrivalStream contract -- $name', ({ make }) => {
  let clock: FakeClock;
  let log: Log;

  beforeEach(() => {
    clock = new FakeClock(1_000_000);
    log = make(clock);
  });

  it('an appended record is pulled back whole, inline body or BlobStore key, with its Assertion', async () => {
    await log.subscribe({ subscription: SUBSCRIPTION, start: 'earliest' });
    await log.append(record('a'));
    await log.append(blobRecord);
    const leased = await log.pull({ subscription: SUBSCRIPTION, workerId: 'w1', max: 10 });
    expect(leased.map((l) => l.record)).toEqual([record('a'), blobRecord]);
  });

  it('pull leases records in append order, up to max, with increasing offsets', async () => {
    await log.subscribe({ subscription: SUBSCRIPTION, start: 'earliest' });
    await appendAll(log, ['a', 'b', 'c']);
    const first = await log.pull({ subscription: SUBSCRIPTION, workerId: 'w1', max: 2 });
    expect(ids(first)).toEqual(['a', 'b']);
    expect(first[0]!.offset).toBeLessThan(first[1]!.offset);
    expect(ids(await log.pull({ subscription: SUBSCRIPTION, workerId: 'w1', max: 2 }))).toEqual(['c']);
  });

  it('a leased record is not delivered again while its lease holds', async () => {
    await log.subscribe({ subscription: SUBSCRIPTION, start: 'earliest' });
    await appendAll(log, ['a']);
    await log.pull({ subscription: SUBSCRIPTION, workerId: 'w1', max: 10 });
    clock.advance(LEASE_MS - 1);
    expect(await log.pull({ subscription: SUBSCRIPTION, workerId: 'w2', max: 10 })).toEqual([]);
  });

  it('an acked record is never delivered again, even after its lease would have run out', async () => {
    await log.subscribe({ subscription: SUBSCRIPTION, start: 'earliest' });
    await appendAll(log, ['a', 'b']);
    const leased = await log.pull({ subscription: SUBSCRIPTION, workerId: 'w1', max: 10 });
    await log.ack({ subscription: SUBSCRIPTION, workerId: 'w1', offsets: [leased[0]!.offset] });
    clock.advance(LEASE_MS);
    expect(ids(await log.pull({ subscription: SUBSCRIPTION, workerId: 'w1', max: 10 }))).toEqual(['b']);
  });

  it('a record whose lease ran out unacked is redelivered (at least once)', async () => {
    await log.subscribe({ subscription: SUBSCRIPTION, start: 'earliest' });
    await appendAll(log, ['a']);
    await log.pull({ subscription: SUBSCRIPTION, workerId: 'w1', max: 10 });
    clock.advance(LEASE_MS);
    expect(ids(await log.pull({ subscription: SUBSCRIPTION, workerId: 'w2', max: 10 }))).toEqual(['a']);
  });

  it('a nacked record is released for redelivery at once', async () => {
    await log.subscribe({ subscription: SUBSCRIPTION, start: 'earliest' });
    await appendAll(log, ['a']);
    const leased = await log.pull({ subscription: SUBSCRIPTION, workerId: 'w1', max: 10 });
    await log.nack({ subscription: SUBSCRIPTION, workerId: 'w1', offsets: leased.map((l) => l.offset) });
    expect(ids(await log.pull({ subscription: SUBSCRIPTION, workerId: 'w2', max: 10 }))).toEqual(['a']);
  });

  it('an extended lease outlives its first expiry', async () => {
    await log.subscribe({ subscription: SUBSCRIPTION, start: 'earliest' });
    await appendAll(log, ['a']);
    const leased = await log.pull({ subscription: SUBSCRIPTION, workerId: 'w1', max: 10 });
    clock.advance(LEASE_MS - 1);
    await log.extend({ subscription: SUBSCRIPTION, workerId: 'w1', offsets: leased.map((l) => l.offset) });
    clock.advance(LEASE_MS - 1);
    expect(await log.pull({ subscription: SUBSCRIPTION, workerId: 'w2', max: 10 })).toEqual([]);
    clock.advance(1);
    expect(ids(await log.pull({ subscription: SUBSCRIPTION, workerId: 'w2', max: 10 }))).toEqual(['a']);
  });

  it('only the lease holder can ack: a stale worker cannot ack a record another worker re-leased', async () => {
    await log.subscribe({ subscription: SUBSCRIPTION, start: 'earliest' });
    await appendAll(log, ['a']);
    const stale = await log.pull({ subscription: SUBSCRIPTION, workerId: 'w1', max: 10 });
    clock.advance(LEASE_MS);
    await log.pull({ subscription: SUBSCRIPTION, workerId: 'w2', max: 10 });
    await log.ack({ subscription: SUBSCRIPTION, workerId: 'w1', offsets: stale.map((l) => l.offset) });
    clock.advance(LEASE_MS);
    expect(ids(await log.pull({ subscription: SUBSCRIPTION, workerId: 'w3', max: 10 }))).toEqual(['a']);
  });

  it('two workers on one subscription split its records without overlap', async () => {
    await log.subscribe({ subscription: SUBSCRIPTION, start: 'earliest' });
    await appendAll(log, ['a', 'b', 'c', 'd']);
    const one = await log.pull({ subscription: SUBSCRIPTION, workerId: 'w1', max: 2 });
    const two = await log.pull({ subscription: SUBSCRIPTION, workerId: 'w2', max: 10 });
    expect(ids(one)).toEqual(['a', 'b']);
    expect(ids(two)).toEqual(['c', 'd']);
  });

  it('subscriptions are independent: each sees every record', async () => {
    await log.subscribe({ subscription: 'one', start: 'earliest' });
    await log.subscribe({ subscription: 'two', start: 'earliest' });
    await appendAll(log, ['a']);
    await log.pull({ subscription: 'one', workerId: 'w1', max: 10 });
    expect(ids(await log.pull({ subscription: 'two', workerId: 'w1', max: 10 }))).toEqual(['a']);
  });

  it('an earliest subscription sees records appended before it; a latest one only those after', async () => {
    await appendAll(log, ['before']);
    await log.subscribe({ subscription: 'from-earliest', start: 'earliest' });
    await log.subscribe({ subscription: 'from-latest', start: 'latest' });
    await appendAll(log, ['after']);
    expect(ids(await log.pull({ subscription: 'from-earliest', workerId: 'w1', max: 10 }))).toEqual(['before', 'after']);
    expect(ids(await log.pull({ subscription: 'from-latest', workerId: 'w1', max: 10 }))).toEqual(['after']);
  });

  it('subscribing again keeps the original start point', async () => {
    await log.subscribe({ subscription: SUBSCRIPTION, start: 'earliest' });
    await appendAll(log, ['a']);
    await log.subscribe({ subscription: SUBSCRIPTION, start: 'latest' });
    expect(ids(await log.pull({ subscription: SUBSCRIPTION, workerId: 'w1', max: 10 }))).toEqual(['a']);
  });

  it('pulling from a subscription that was never made delivers nothing', async () => {
    await appendAll(log, ['a']);
    expect(await log.pull({ subscription: 'nobody', workerId: 'w1', max: 10 })).toEqual([]);
  });
});
