/**
 * LogArrivalStream -- the ArrivalStream and ArrivalSubscription over one
 * LogDO (the local stand-in for K2; architecture A14). It reaches the object
 * through its stub, and supplies the clock reading and lease length on every
 * leasing call, so lease time is the injected Clock's, not the object's.
 * An append the object did not confirm is reported retryable.
 */

import type { ArrivalRecord, Durability } from '../../domain/ingest/arrival.js';
import type { LeasedRecord, SubscriptionStart } from '../../domain/ingest/subscription.js';
import type { ArrivalStream } from '../../ports/arrival-stream.js';
import type { ArrivalSubscription } from '../../ports/arrival-subscription.js';
import type { Clock } from '../../ports/clock.js';
import type { ExtendRequest, HeldRequest, PullRequest } from './log.js';

/** The RPC surface LogDO offers; a Durable Object stub of LogDO satisfies it. */
export interface LogStub {
  append(record: ArrivalRecord): Promise<{ offset: number }>;
  subscribe(request: { subscription: string; start: SubscriptionStart }): Promise<void>;
  pull(request: PullRequest): Promise<LeasedRecord[]>;
  ack(request: HeldRequest): Promise<void>;
  nack(request: HeldRequest): Promise<void>;
  extend(request: ExtendRequest): Promise<void>;
  unsubscribe(request: { subscription: string }): Promise<void>;
}

type Held = { subscription: string; workerId: string; offsets: readonly number[] };

export class LogArrivalStream implements ArrivalStream, ArrivalSubscription {
  readonly #log: LogStub;
  readonly #clock: Clock;
  readonly #leaseMs: number;

  constructor({ log, clock, leaseMs }: { log: LogStub; clock: Clock; leaseMs: number }) {
    this.#log = log;
    this.#clock = clock;
    this.#leaseMs = leaseMs;
  }

  async append(record: ArrivalRecord): Promise<Durability> {
    try {
      await this.#log.append(record);
      return { ok: true };
    } catch (error) {
      console.error(JSON.stringify({ event: 'arrival-stream.append-failed', recordId: record.id, error: String(error) }));
      return { ok: false, retryable: true };
    }
  }

  async subscribe(request: { subscription: string; start: SubscriptionStart }): Promise<void> {
    await this.#log.subscribe(request);
  }

  async pull(request: { subscription: string; workerId: string; max: number }): Promise<LeasedRecord[]> {
    return this.#log.pull({ ...request, now: this.#clock.now(), leaseMs: this.#leaseMs });
  }

  async ack(request: Held): Promise<void> {
    await this.#log.ack(request);
  }

  async nack(request: Held): Promise<void> {
    await this.#log.nack(request);
  }

  async extend(request: Held): Promise<void> {
    await this.#log.extend({ ...request, now: this.#clock.now(), leaseMs: this.#leaseMs });
  }

  async unsubscribe(request: { subscription: string }): Promise<void> {
    await this.#log.unsubscribe(request);
  }
}
