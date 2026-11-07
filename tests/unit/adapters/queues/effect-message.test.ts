// Effect messages on the `effects` queue: each Issue Change travels with the
// Project it belongs to, since the change does not carry it, and the
// consumer reads back exactly what the producer sent.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseEffectMessage, QueueEffectQueue, type EffectMessage } from '../../../../src/adapters/queues/queue-effect-queue.js';
import type { IssueChange } from '../../../../src/domain/issue/state.js';

const CHANGE: IssueChange = {
  issueId: 'issue-1',
  kind: 'status',
  from: null,
  to: 'unresolved/new',
  actor: 'system',
  origin: 'nightwatch',
  at: 1_000,
};

/** A Queue producer that keeps every body sent. */
function recordingQueue(): { queue: Queue; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const queue = {
    send: async (body: unknown) => {
      bodies.push(body);
    },
    sendBatch: async (messages: Iterable<MessageSendRequest>) => {
      for (const message of messages) bodies.push(message.body);
    },
    metrics: async () => ({ backlogCount: 0, backlogBytes: 0 }),
  } as unknown as Queue;
  return { queue, bodies };
}

const actor = fc.oneof(
  fc.constantFrom('system', 'tracker', 'commit', 'sweep', 'reporter', 'spam_judge'),
  fc.record({ member: fc.string() }),
);

const change: fc.Arbitrary<IssueChange> = fc.record({
  issueId: fc.string({ minLength: 1 }),
  kind: fc.constantFrom('status', 'priority', 'resolution', 'for_review', 'merge', 'split', 'comment', 'assignee'),
  from: fc.option(fc.string(), { nil: null }),
  to: fc.option(fc.string(), { nil: null }),
  actor,
  origin: fc.constantFrom('nightwatch', 'tracker'),
  at: fc.integer({ min: 0 }),
});

describe('QueueEffectQueue', () => {
  it('sends each Issue Change with the Project it belongs to', async () => {
    const { queue, bodies } = recordingQueue();
    await new QueueEffectQueue(queue, () => 'project-1').enqueue([CHANGE, { ...CHANGE, kind: 'for_review', to: 'in' }]);
    expect(bodies).toEqual([
      { projectId: 'project-1', change: CHANGE },
      { projectId: 'project-1', change: { ...CHANGE, kind: 'for_review', to: 'in' } },
    ]);
  });

  it('refuses to send a change no Project has claimed, since nothing could act on it', async () => {
    const { queue, bodies } = recordingQueue();
    await expect(new QueueEffectQueue(queue, () => null).enqueue([CHANGE])).rejects.toThrow(/no project/);
    expect(bodies).toEqual([]);
  });
});

describe('parseEffectMessage', () => {
  it('reads back every message the producer sends, with or without a step', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        change,
        fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        (projectId, sent, step) => {
          const message: EffectMessage = step === undefined ? { projectId, change: sent } : { projectId, change: sent, step };
          expect(parseEffectMessage(JSON.parse(JSON.stringify(message)))).toEqual(message);
        },
      ),
    );
  });

  it('answers null for a body that is not an effect message', () => {
    expect(parseEffectMessage(CHANGE)).toBeNull();
    expect(parseEffectMessage({ projectId: '', change: CHANGE })).toBeNull();
    expect(parseEffectMessage({ projectId: 'project-1', change: { ...CHANGE, kind: 'other' } })).toBeNull();
    expect(parseEffectMessage('nope')).toBeNull();
  });
});
