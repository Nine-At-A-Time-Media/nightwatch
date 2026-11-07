// storedOwnershipFacts: the ownership facts read back from an Event as
// processing stored it (encodeScrubbedEvent), so owners can be suggested
// after the fact from the stored copy; anything else reads as none.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../../../../src/domain/normalize/normalized-event.js';
import { ownershipFactsOf, storedOwnershipFacts } from '../../../../src/domain/ownership/facts.js';
import { encodeScrubbedEvent } from '../../../../src/domain/processing/processing.js';

const frame = fc.record(
  {
    filename: fc.string(),
    absPath: fc.string(),
    module: fc.string(),
    lineno: fc.integer({ min: 1 }),
    inApp: fc.boolean(),
  },
  { requiredKeys: [] },
);

const event = fc.record({
  exceptions: fc.array(fc.record({ type: fc.constant(null), value: fc.constant(null), frames: fc.array(frame) }), { maxLength: 3 }),
  stacktrace: fc.option(fc.array(frame), { nil: null }),
  request: fc.option(fc.record({ url: fc.webUrl(), headers: fc.constant({}) }, { requiredKeys: ['headers'] }), { nil: null }),
  tags: fc.dictionary(fc.string(), fc.string()),
}) as fc.Arbitrary<unknown> as fc.Arbitrary<NormalizedEvent>;

describe('storedOwnershipFacts', () => {
  it('reads back the facts of the Event processing stored', () => {
    fc.assert(
      fc.property(event, (stored) => {
        expect(storedOwnershipFacts(encodeScrubbedEvent({ event: stored, removals: [] }))).toEqual(ownershipFactsOf(stored));
      }),
    );
  });

  it('reads no facts from bytes that are not a stored Event, and never throws', () => {
    fc.assert(
      fc.property(fc.uint8Array(), (bytes) => {
        expect(() => storedOwnershipFacts(bytes)).not.toThrow();
      }),
    );
    expect(storedOwnershipFacts(new TextEncoder().encode('{"event":{"exceptions":"no"}}'))).toBeNull();
    expect(storedOwnershipFacts(new TextEncoder().encode('not json'))).toBeNull();
  });
});
