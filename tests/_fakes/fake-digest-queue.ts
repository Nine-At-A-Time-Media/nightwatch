/**
 * FakeDigestQueue -- an in-memory DigestQueue: one Digest per recipient and
 * rule, timed by the DigestPolicy it is built with, as DigestDO would be.
 * `take` hands over the Digest and empties it.
 */

import { digestDueAt, emptyDigest, gather, type Digest, type DigestItem, type DigestPolicy } from '../../src/domain/alerts/digest.js';
import type { DigestKey, DigestQueue } from '../../src/ports/digest-queue.js';

function keyOf(key: DigestKey): string {
  return `${key.ruleId}\u0000${key.recipient}`;
}

export class FakeDigestQueue implements DigestQueue {
  readonly #policy: DigestPolicy;
  readonly #digests = new Map<string, Digest>();

  constructor(policy: DigestPolicy) {
    this.#policy = policy;
  }

  async add(key: DigestKey, item: DigestItem): Promise<number> {
    const digest = gather(this.#digests.get(keyOf(key)) ?? emptyDigest(key), item);
    this.#digests.set(keyOf(key), digest);
    return digestDueAt(digest, this.#policy) ?? item.at;
  }

  async take(key: DigestKey): Promise<Digest> {
    const digest = this.#digests.get(keyOf(key)) ?? emptyDigest(key);
    this.#digests.delete(keyOf(key));
    return digest;
  }

  /** The keys holding a Digest, for assertions. */
  keys(): readonly DigestKey[] {
    return [...this.#digests.values()].map(({ ruleId, recipient }) => ({ ruleId, recipient }));
  }
}
