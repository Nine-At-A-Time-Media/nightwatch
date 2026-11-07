// FakeArrivalStream -- an in-memory arrival log: ArrivalStream that keeps Arrival Records, or fails when told to,
// and ArrivalSubscription over the same records, with leases timed by an injected Clock.
import type { ArrivalRecord, Durability } from '../../src/domain/ingest/arrival.js';
import type { LeasedRecord, SubscriptionStart } from '../../src/domain/ingest/subscription.js';
import type { ArrivalStream } from '../../src/ports/arrival-stream.js';
import type { ArrivalSubscription } from '../../src/ports/arrival-subscription.js';
import type { Clock } from '../../src/ports/clock.js';
import { FakeClock } from './fake-clock.js';

type Delivery = { workerId: string | null; leaseExpiresAt: number; acked: boolean };
type Subscription = { after: number; deliveries: Map<number, Delivery> };
type Held = { subscription: string; workerId: string; offsets: readonly number[] };

export class FakeArrivalStream implements ArrivalStream, ArrivalSubscription {
  readonly records: ArrivalRecord[] = [];
  failure: { retryable: boolean } | null = null;
  readonly #subscriptions = new Map<string, Subscription>();
  readonly #clock: Clock;
  readonly #leaseMs: number;

  constructor({ clock = new FakeClock(0), leaseMs = 30_000 }: { clock?: Clock; leaseMs?: number } = {}) {
    this.#clock = clock;
    this.#leaseMs = leaseMs;
  }

  async append(record: ArrivalRecord): Promise<Durability> {
    if (this.failure) return { ok: false, retryable: this.failure.retryable };
    this.records.push(record);
    return { ok: true };
  }

  async subscribe({ subscription, start }: { subscription: string; start: SubscriptionStart }): Promise<void> {
    if (this.#subscriptions.has(subscription)) return;
    this.#subscriptions.set(subscription, { after: start === 'earliest' ? 0 : this.records.length, deliveries: new Map() });
  }

  async pull({ subscription, workerId, max }: { subscription: string; workerId: string; max: number }): Promise<LeasedRecord[]> {
    const sub = this.#subscriptions.get(subscription);
    if (!sub) return [];
    const now = this.#clock.now();
    const leased: LeasedRecord[] = [];
    for (let offset = sub.after + 1; offset <= this.records.length && leased.length < max; offset += 1) {
      const delivery = sub.deliveries.get(offset);
      if (delivery && (delivery.acked || delivery.leaseExpiresAt > now)) continue;
      sub.deliveries.set(offset, { workerId, leaseExpiresAt: now + this.#leaseMs, acked: false });
      leased.push({ offset, record: this.records[offset - 1]! });
    }
    return leased;
  }

  async ack(request: Held): Promise<void> {
    for (const delivery of this.#held(request)) delivery.acked = true;
  }

  async nack(request: Held): Promise<void> {
    for (const delivery of this.#held(request)) Object.assign(delivery, { workerId: null, leaseExpiresAt: 0 });
  }

  async extend(request: Held): Promise<void> {
    const now = this.#clock.now();
    for (const delivery of this.#held(request)) if (delivery.leaseExpiresAt > now) delivery.leaseExpiresAt = now + this.#leaseMs;
  }

  #held({ subscription, workerId, offsets }: Held): Delivery[] {
    const sub = this.#subscriptions.get(subscription);
    const deliveries = offsets.map((offset) => sub?.deliveries.get(offset));
    return deliveries.filter((d): d is Delivery => d !== undefined && !d.acked && d.workerId === workerId);
  }
}
