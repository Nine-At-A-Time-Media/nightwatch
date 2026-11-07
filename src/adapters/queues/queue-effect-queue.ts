/**
 * QueueEffectQueue -- the EffectQueue over a Cloudflare Queues producer
 * binding (architecture Seams: Side-effect dispatch). Each Issue Change is one
 * message; a batch is sent in chunks the Queues batch limit allows.
 */

import type { IssueChange } from '../../domain/issue/state.js';
import type { EffectQueue } from '../../ports/effect-queue.js';

/** The most messages one sendBatch call takes. */
const BATCH_LIMIT = 100;

// --- helpers ---

export function chunksOf<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

// --- adapter ---

export class QueueEffectQueue implements EffectQueue {
  readonly #queue: Queue;

  constructor(queue: Queue) {
    this.#queue = queue;
  }

  async enqueue(changes: readonly IssueChange[]): Promise<void> {
    for (const chunk of chunksOf(changes, BATCH_LIMIT)) await this.#queue.sendBatch(chunk.map((change) => ({ body: change })));
  }
}
