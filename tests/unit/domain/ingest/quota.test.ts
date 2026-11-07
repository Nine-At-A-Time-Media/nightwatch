import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { ItemFate } from '../../../../src/domain/ingest/items.js';
import { applyQuotaDenials, capRetryAdvice, openQuantities } from '../../../../src/domain/ingest/quota.js';
import type { RetryAdviceEntry } from '../../../../src/domain/protocol/retry-advice.js';

const item = (type: string) => ({ header: { type }, payload: new Uint8Array() });
const fates: ItemFate[] = [
  { item: item('event'), category: 'error', verdict: null },
  { item: item('session'), category: 'session', verdict: null },
  { item: item('event'), category: 'error', verdict: null },
  { item: item('event'), category: 'error', verdict: { kind: 'invalid', reason: 'too-large' } },
];

const advice: RetryAdviceEntry = { retryAfterSeconds: 60, categories: ['error'], scope: 'project', reason: 'quota-exceeded' };

describe('openQuantities', () => {
  it('counts the open items per category, in first-seen order, ignoring decided items', () => {
    expect(openQuantities(fates)).toEqual([
      { category: 'error', quantity: 2 },
      { category: 'session', quantity: 1 },
    ]);
  });
});

describe('applyQuotaDenials', () => {
  it('rate limits the open items of a denied category with the advice reason, and leaves the rest', () => {
    const after = applyQuotaDenials({ fates, denials: new Map([['error', advice]]) });
    expect(after.map((f) => f.verdict)).toEqual([
      { kind: 'rate_limited', reason: 'quota-exceeded' },
      null,
      { kind: 'rate_limited', reason: 'quota-exceeded' },
      { kind: 'invalid', reason: 'too-large' },
    ]);
  });

  it('names a generic reason when the advice carries none', () => {
    const after = applyQuotaDenials({ fates, denials: new Map([['session', { ...advice, categories: ['session'], reason: null }]]) });
    expect(after[1]!.verdict).toEqual({ kind: 'rate_limited', reason: 'quota-exceeded' });
  });
});

describe('capRetryAdvice', () => {
  it('never advises waiting longer than the ceiling, and keeps shorter advice', () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), (wait, ceiling) => {
        const capped = capRetryAdvice({ entry: { ...advice, retryAfterSeconds: wait }, ceilingSeconds: ceiling });
        expect(capped.retryAfterSeconds).toBe(Math.min(wait, ceiling));
        expect(capped.categories).toEqual(advice.categories);
      }),
    );
  });
});
