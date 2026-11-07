/**
 * DurableDigestQueue -- the DigestQueue over the DigestDO namespace
 * (architecture Seams and Mechanism, Alerts and notifications: DigestDO, one
 * per recipient and rule). The object for a Digest is the one named by its
 * rule and recipient together, so every item for that pair reaches the same
 * object and its one alarm.
 */

import type { Digest, DigestItem } from '../../domain/alerts/digest.js';
import type { DigestKey, DigestQueue } from '../../ports/digest-queue.js';

/** The DigestDO namespace as this client uses it; a Durable Object namespace binding of DigestDO satisfies it. */
export interface DigestNamespace {
  getByName(name: string): DigestQueue;
}

// --- helpers ---

/** The object name of one Digest: rule and recipient, joined by a character neither can hold. */
export function digestObjectName(key: DigestKey): string {
  return `${key.ruleId}\u0000${key.recipient}`;
}

// --- adapter ---

export class DurableDigestQueue implements DigestQueue {
  readonly #namespace: DigestNamespace;

  constructor({ namespace }: { namespace: DigestNamespace }) {
    this.#namespace = namespace;
  }

  add(key: DigestKey, item: DigestItem): Promise<number> {
    return this.#namespace.getByName(digestObjectName(key)).add(key, item);
  }

  take(key: DigestKey): Promise<Digest> {
    return this.#namespace.getByName(digestObjectName(key)).take(key);
  }
}
