import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatShortId, isShortId, shortIdNumber, shortIdSlug } from '../../../../src/domain/issue/short-id.js';

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

describe('Short Id slug', () => {
  it("is the Project's own slug when it has one, and otherwise its id's letters and digits", () => {
    expect(shortIdSlug({ projectId: 'project-1', slug: 'Web' })).toBe('Web');
    expect(shortIdSlug({ projectId: 'project-1', slug: null })).toBe('project1');
    expect(shortIdSlug({ projectId: '9f3a-77', slug: null })).toBe('P9f3a77');
  });

  it('property: any Project id gives Short Ids that match the grammar', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 2 ** 40 }), (projectId, counter) =>
        isShortId(formatShortId({ slug: shortIdSlug({ projectId, slug: null }), counter })),
      ),
    );
  });
});
