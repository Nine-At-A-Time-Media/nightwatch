/**
 * FakeEffectQueue -- an EffectQueue that keeps what was enqueued, in order.
 */

import type { IssueChange } from '../../src/domain/issue/state.js';
import type { EffectQueue } from '../../src/ports/effect-queue.js';

export class FakeEffectQueue implements EffectQueue {
  readonly enqueued: IssueChange[] = [];

  async enqueue(changes: readonly IssueChange[]): Promise<void> {
    this.enqueued.push(...changes);
  }
}
