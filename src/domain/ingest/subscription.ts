/**
 * Subscription values -- how a consumer reads the durable arrival log
 * (architecture, Mechanism: Stream consumption). A subscription starts at the
 * earliest retained record or at the latest one, and hands out Arrival
 * Records under leases, each at its offset in the log.
 */

import type { ArrivalRecord } from './arrival.js';

/** Where a new subscription begins: every retained record, or only those appended after it. */
export type SubscriptionStart = 'earliest' | 'latest';

/** An Arrival Record leased to one worker, at its offset in the log. */
export type LeasedRecord = { readonly offset: number; readonly record: ArrivalRecord };
