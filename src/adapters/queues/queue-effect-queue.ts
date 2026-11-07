/**
 * QueueEffectQueue -- the EffectQueue over a Cloudflare Queues producer
 * binding (architecture Seams: Side-effect dispatch). Each Issue Change is one
 * message; a batch is sent in chunks the Queues batch limit allows.
 *
 * An Issue Change does not name its Project, so every message carries the
 * Project beside the change: the producer's runtime says which Project it
 * holds (a ProjectDO knows once a call has claimed it). A consumer may add
 * a `step`, naming the one piece of work a message stands for, when it fans
 * a change out into one message per step. `parseEffectMessage` reads a body
 * back on the consumer side and answers null for anything else.
 */

import { z } from 'zod';
import type { ProjectId } from '../../domain/ids.js';
import type { IssueChange } from '../../domain/issue/state.js';
import type { EffectQueue } from '../../ports/effect-queue.js';

/** One message on the `effects` queue. */
export type EffectMessage = { readonly projectId: ProjectId; readonly change: IssueChange; readonly step?: string };

/** The most messages one sendBatch call takes. */
const BATCH_LIMIT = 100;

const ActorShape = z.union([
  z.enum(['system', 'tracker', 'commit', 'sweep', 'reporter', 'spam_judge']),
  z.object({ member: z.string() }).transform(({ member }) => ({ member })),
]);

const IssueChangeShape = z.object({
  issueId: z.string().min(1),
  kind: z.enum(['status', 'priority', 'resolution', 'for_review', 'merge', 'split', 'comment', 'assignee']),
  from: z.string().nullable(),
  to: z.string().nullable(),
  actor: ActorShape,
  origin: z.enum(['nightwatch', 'tracker']),
  at: z.number(),
});

const EffectMessageShape = z.object({
  projectId: z.string().min(1),
  change: IssueChangeShape,
  step: z.string().min(1).optional(),
});

// --- helpers ---

export function chunksOf<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

/** The effect message a body holds, or null when it holds none. */
export function parseEffectMessage(body: unknown): EffectMessage | null {
  const parsed = EffectMessageShape.safeParse(body);
  if (!parsed.success) return null;
  const { projectId, change, step } = parsed.data;
  return step === undefined ? { projectId, change } : { projectId, change, step };
}

// --- actions ---

/** Sends the messages in order, in chunks the Queues batch limit allows. */
export async function sendEffectMessages(queue: Queue, messages: readonly EffectMessage[]): Promise<void> {
  for (const chunk of chunksOf(messages, BATCH_LIMIT)) await queue.sendBatch(chunk.map((message) => ({ body: message })));
}

// --- adapter ---

export class QueueEffectQueue implements EffectQueue {
  readonly #queue: Queue;
  readonly #project: () => ProjectId | null;

  /** `project` names the Project the producing runtime holds, or null before it holds one. */
  constructor(queue: Queue, project: () => ProjectId | null) {
    this.#queue = queue;
    this.#project = project;
  }

  async enqueue(changes: readonly IssueChange[]): Promise<void> {
    if (changes.length === 0) return;
    const projectId = this.#project();
    if (projectId === null) throw new Error('effects: no project claimed for these changes');
    await sendEffectMessages(
      this.#queue,
      changes.map((change) => ({ projectId, change })),
    );
  }
}
