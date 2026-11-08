/**
 * DigestQueue -- the seam for gathering issue alert emails into Digests
 * (design Alerts and notifications, Digest; architecture Mechanism: DigestDO,
 * one per recipient and rule, buffers items and sets its alarm from
 * DigestPolicy). DigestDO in production, an in-memory fake in tests.
 *
 * `add` gathers one item and answers when the Digest is now due, by the
 * DigestPolicy the runtime holds. `take` hands over the Digest gathered so
 * far, which deliverDigest sends; the runtime keeps whatever deliverDigest
 * returns.
 */

import type { DigestItem, Digest } from '../domain/alerts/digest.js';

/** One Digest per recipient address and Issue Alert Rule. */
export type DigestKey = { readonly ruleId: string; readonly recipient: string };

export interface DigestQueue {
  /** Gathers the item; returns when the Digest is due, in epoch milliseconds. */
  add(key: DigestKey, item: DigestItem): Promise<number>;
  take(key: DigestKey): Promise<Digest>;
}
