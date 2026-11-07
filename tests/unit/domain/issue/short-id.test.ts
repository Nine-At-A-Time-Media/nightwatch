import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatShortId, isShortId, shortIdNumber } from '../../../../src/domain/issue/short-id.js';

describe('Short Id', () => {
  it('spells a Project counter as the slug and a base32 suffix', () => {
    expect(formatShortId({ slug: 'web', counter: 1 })).toBe('WEB-1');
    expect(formatShortId({ slug: 'Web', counter: 32 })).toBe('WEB-10');
    expect(formatShortId({ slug: 'api2', counter: 31 })).toBe('API2-Z');
  });

  it('round-trips every counter and always matches the grammar it is recognised by', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/), fc.integer({ min: 1, max: 2 ** 40 }), (slug, counter) => {
        const id = formatShortId({ slug, counter });
        expect(isShortId(id)).toBe(true);
        expect(shortIdNumber(id)).toBe(counter);
      }),
    );
  });
});
