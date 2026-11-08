import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { comparePlatformUsage, softLimitMessage } from '../../../../src/domain/operating/platform-usage.js';

const limits = new Map([
  ['workers_requests', 100_000],
  ['r2_storage_bytes', 10_000_000_000],
]);

describe('comparePlatformUsage', () => {
  it('marks a product over only when its use is above its Platform Soft Limit; a product with no limit is never over', () => {
    expect(
      comparePlatformUsage(
        [
          { product: 'workers_requests', used: 100_001 },
          { product: 'r2_storage_bytes', used: 10_000_000_000 },
          { product: 'k2_storage_bytes', used: 5 },
        ],
        limits,
      ),
    ).toEqual([
      { product: 'workers_requests', used: 100_001, softLimit: 100_000, over: true },
      { product: 'r2_storage_bytes', used: 10_000_000_000, softLimit: 10_000_000_000, over: false },
      { product: 'k2_storage_bytes', used: 5, softLimit: null, over: false },
    ]);
  });

  it('is over exactly when the use exceeds the limit', () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), (used, softLimit) => {
        const [compared] = comparePlatformUsage([{ product: 'p', used }], new Map([['p', softLimit]]));
        expect(compared?.over).toBe(used > softLimit);
      }),
    );
  });
});

describe('softLimitMessage', () => {
  it('names the product, its use and its limit, with one delivery identity per product and comparison', () => {
    const message = softLimitMessage({ usage: { product: 'workers_requests', used: 120_000, softLimit: 100_000, over: true }, at: 42 });
    expect(message).toMatchObject({ deliveryId: 'platform-soft-limit:workers_requests:42', issueId: null });
    expect(message.subject).toContain('workers_requests');
    expect(message.text).toContain('120000');
    expect(message.text).toContain('100000');
  });
});
