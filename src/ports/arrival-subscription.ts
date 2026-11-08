/**
 * ArrivalSubscription -- the consuming side of the durable arrival log.
 * Delivery is at least once: a pulled record is leased to one worker of the
 * subscription; acking ends it for good, nacking or letting the lease run out
 * makes it deliverable again. Only the worker holding a lease can ack, nack
 * or extend it. Records come in append order; several workers on one
 * subscription split them.
 */

import type { LeasedRecord, SubscriptionStart } from '../domain/ingest/subscription.js';

export interface ArrivalSubscription {
  /** Make the subscription if it does not exist; an existing one keeps its start point. */
  subscribe(request: { subscription: string; start: SubscriptionStart }): Promise<void>;
  /** Lease up to `max` deliverable records to `workerId`. An unknown subscription delivers nothing. */
  pull(request: { subscription: string; workerId: string; max: number }): Promise<LeasedRecord[]>;
  ack(request: { subscription: string; workerId: string; offsets: readonly number[] }): Promise<void>;
  nack(request: { subscription: string; workerId: string; offsets: readonly number[] }): Promise<void>;
  /** Renew leases still held; a lease that already ran out is not revived. */
  extend(request: { subscription: string; workerId: string; offsets: readonly number[] }): Promise<void>;
  // --- task-031: reprocessing deletes its subscription when done ---

  /** Forgets the subscription with its deliveries and leases; forgetting an unknown one does nothing. */
  unsubscribe(request: { subscription: string }): Promise<void>;
}
