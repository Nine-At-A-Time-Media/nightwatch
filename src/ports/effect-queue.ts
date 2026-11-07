/**
 * EffectQueue -- the seam for side-effect dispatch (architecture Seams:
 * Side-effect dispatch). Issue Changes are enqueued after the state that
 * caused them is written; consumers (alerts, notifications, tracker sync)
 * act on them. Queues in production, an in-memory fake in tests.
 */

import type { IssueChange } from '../domain/issue/state.js';

export interface EffectQueue {
  enqueue(changes: readonly IssueChange[]): Promise<void>;
}
