// QueueEffectQueue's batching: every Issue Change is sent once, in order, in
// chunks no larger than the Queues batch limit.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chunksOf } from '../../../../src/adapters/queues/queue-effect-queue.js';

describe('chunksOf', () => {
  it('splits a list into chunks of at most the size that join back into it', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), fc.integer({ min: 1, max: 10 }), (items, size) => {
        const chunks = chunksOf(items, size);
        expect(chunks.flat()).toEqual(items);
        expect(chunks.every((chunk) => chunk.length >= 1 && chunk.length <= size)).toBe(true);
      }),
    );
  });
});
