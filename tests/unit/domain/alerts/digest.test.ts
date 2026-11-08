import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  digestDueAt,
  digestPolicy,
  digestSummaryLines,
  dueAt,
  emptyDigest,
  gather,
  isDigestDue,
  type DigestItem,
  type DigestPolicy,
} from '../../../../src/domain/alerts/digest.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { MINUTE, T0 } from '../issue/fixtures.js';

const policy: DigestPolicy = { minimumDelayMs: 5 * MINUTE, incrementMs: 2 * MINUTE, maximumDelayMs: 30 * MINUTE };

function itemAt(at: number, issueId = 'issue-1', title = 'TypeError: x is undefined'): DigestItem {
  return { issueId, title, at };
}

const policyArbitrary: fc.Arbitrary<DigestPolicy> = fc
  .record({ minimum: fc.nat(60 * MINUTE), spread: fc.integer({ min: 1, max: 60 * MINUTE }), increment: fc.nat(60 * MINUTE) })
  .map(({ minimum, spread, increment }) => ({ minimumDelayMs: minimum, incrementMs: increment, maximumDelayMs: minimum + spread }));

describe('Digest', () => {
  it('Digest gathers: Given several alerts for one recipient and rule in a burst, When the Digest is due, Then one email lists them all', () => {
    const digest = [itemAt(T0), itemAt(T0 + MINUTE, 'issue-2', 'RangeError: bad length'), itemAt(T0 + 2 * MINUTE)].reduce(
      gather,
      emptyDigest({ ruleId: 'rule-1', recipient: 'ada@example.com' }),
    );
    expect(isDigestDue(digest, policy, T0 + 4 * MINUTE)).toBe(false);
    expect(isDigestDue(digest, policy, T0 + 5 * MINUTE)).toBe(true);
    expect(digestSummaryLines(digest)).toEqual(['TypeError: x is undefined (2 alerts)', 'RangeError: bad length (1 alert)']);
  });

  it('an empty Digest is never due', () => {
    const digest = emptyDigest({ ruleId: 'rule-1', recipient: 'ada@example.com' });
    expect(digestDueAt(digest, policy)).toBeNull();
    expect(isDigestDue(digest, policy, T0 + 365 * 24 * 60 * MINUTE)).toBe(false);
    expect(digestSummaryLines(digest)).toEqual([]);
  });

  it('each item pushes the due time back by the increment, up to the Digest Maximum Delay', () => {
    expect(dueAt({ firstItemAt: T0, lastItemAt: T0, policy })).toBe(T0 + 5 * MINUTE);
    expect(dueAt({ firstItemAt: T0, lastItemAt: T0 + 10 * MINUTE, policy })).toBe(T0 + 12 * MINUTE);
    expect(dueAt({ firstItemAt: T0, lastItemAt: T0 + 29 * MINUTE, policy })).toBe(T0 + 30 * MINUTE);
  });

  it('a Digest is due no sooner than the Digest Minimum Delay and no later than the Digest Maximum Delay after its first item', () => {
    fc.assert(
      fc.property(policyArbitrary, fc.integer({ min: T0, max: T0 + 1000 * MINUTE }), fc.nat(120 * MINUTE), (p, firstItemAt, gap) => {
        const due = dueAt({ firstItemAt, lastItemAt: firstItemAt + gap, policy: p });
        expect(due).toBeGreaterThanOrEqual(firstItemAt + p.minimumDelayMs);
        expect(due).toBeLessThanOrEqual(firstItemAt + p.maximumDelayMs);
      }),
    );
  });

  it('refuses a policy whose minimum is not below its maximum, or with a negative delay', () => {
    expect(digestPolicy(policy)).toEqual(policy);
    expect(isRefusal(digestPolicy({ ...policy, minimumDelayMs: 30 * MINUTE }))).toBe(true);
    expect(isRefusal(digestPolicy({ ...policy, incrementMs: -1 }))).toBe(true);
    expect(isRefusal(digestPolicy({ ...policy, minimumDelayMs: -1 }))).toBe(true);
  });
});
