/**
 * The Digest inside DigestDO -- one object per recipient and Issue Alert
 * Rule (architecture Mechanism, Alerts and notifications), holding the items
 * gathered so far in the object's storage and the alarm set from the
 * DigestPolicy. Each function takes the object's storage; the DigestDO class
 * only forwards to them, and its alarm hands the held Digest to
 * deliverDigest and keeps what that returns.
 *
 * A Digest that holds items keeps an alarm at its due time; one whose email
 * was not accepted is tried again no sooner than the retry delay. An empty
 * Digest leaves nothing behind.
 */

import { digestDueAt, emptyDigest, gather, type Digest, type DigestItem, type DigestPolicy } from '../../domain/alerts/digest.js';
import type { DigestKey } from '../../ports/digest-queue.js';

const DIGEST = 'digest';

// --- helpers ---

/** When the alarm should next run for a Digest that still holds items. */
export function nextAlarmAt({
  digest,
  policy,
  now,
  retryMs,
}: {
  digest: Digest;
  policy: DigestPolicy;
  now: number;
  retryMs: number;
}): number | null {
  const due = digestDueAt(digest, policy);
  return due === null ? null : Math.max(due, now + retryMs);
}

// --- actions ---

/** The Digest the object holds, or null when it holds none. */
export async function storedDigest(storage: DurableObjectStorage): Promise<Digest | null> {
  return (await storage.get<Digest>(DIGEST)) ?? null;
}

/** Keeps the Digest and sets its alarm; an empty one is removed with its alarm. */
export async function keepDigest(storage: DurableObjectStorage, kept: { digest: Digest; alarmAt: number | null }): Promise<void> {
  if (kept.alarmAt === null || kept.digest.items.length === 0) {
    await storage.delete(DIGEST);
    await storage.deleteAlarm();
    return;
  }
  await storage.put(DIGEST, kept.digest);
  await storage.setAlarm(kept.alarmAt);
}

// --- flows ---

/** Gathers one item and moves the alarm to the Digest's due time, which it returns. */
export async function gatherDigestItem(
  storage: DurableObjectStorage,
  gathering: { key: DigestKey; item: DigestItem; policy: DigestPolicy },
): Promise<number> {
  const digest = gather((await storedDigest(storage)) ?? emptyDigest(gathering.key), gathering.item);
  const due = digestDueAt(digest, gathering.policy) ?? gathering.item.at;
  await keepDigest(storage, { digest, alarmAt: due });
  return due;
}

/** Hands over the Digest gathered so far and empties the object. */
export async function takeDigest(storage: DurableObjectStorage, key: DigestKey): Promise<Digest> {
  const digest = (await storedDigest(storage)) ?? emptyDigest(key);
  await keepDigest(storage, { digest: emptyDigest(key), alarmAt: null });
  return digest;
}
