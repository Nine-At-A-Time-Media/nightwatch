/**
 * Subscription values -- how a consumer reads the durable arrival log
 * (architecture, Mechanism: Stream consumption). A subscription starts at the
 * earliest retained record or at the latest one, and hands out Arrival
 * Records under leases, each at its offset in the log with its delivery count.
 */

import type { ArrivalRecord } from './arrival.js';

/** Where a new subscription begins: every retained record, or only those appended after it. */
export type SubscriptionStart = 'earliest' | 'latest';

/**
 * An Arrival Record leased to one worker, at its offset in the log.
 * `deliveries` counts the leases the record has had on this subscription,
 * this one included, so a consumer can bound its retries.
 */
export type LeasedRecord = { readonly offset: number; readonly record: ArrivalRecord; readonly deliveries: number };
