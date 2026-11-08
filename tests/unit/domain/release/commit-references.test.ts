import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isShortId } from '../../../../src/domain/issue/short-id.js';
import { fixedShortIds } from '../../../../src/domain/release/commit-references.js';

const KEYWORDS = ['fix', 'fixes', 'fixed', 'close', 'closes', 'closed', 'resolve', 'resolves', 'resolved'];
const shortId = fc
  .tuple(fc.stringMatching(/^[A-Z][A-Z0-9]{0,8}$/), fc.stringMatching(/^[0-9A-HJKMNP-TV-Z]{1,6}$/))
  .map(([slug, suffix]) => `${slug}-${suffix}`);
const anyCase = (word: string): fc.Arbitrary<string> =>
  fc
    .array(fc.boolean(), { minLength: word.length, maxLength: word.length })
    .map((upper) => Array.from(word, (c, i) => (upper[i] ? c.toUpperCase() : c)).join(''));
const keyword = fc.constantFrom(...KEYWORDS).chain(anyCase);
const separator = fc.constantFrom(', ', ',', ' ', '  ', ' and ', ', and ', ' AND ');
const lead = fc.constantFrom(' ', ': ', ':', ':  ', '\t');
const tail = fc.constantFrom('', '.', ' in the parser', '\n\nMore detail.', ')', ' and then some');

describe('Commit references', () => {
  it('Resolve by commit: Given an issue with short id S, When a commit says it fixes S, Then S is named', () => {
    expect(fixedShortIds('Fixes NW-1A')).toEqual(['NW-1A']);
    expect(fixedShortIds('parser: handle empty frames\n\nfixes: WEB-3K')).toEqual(['WEB-3K']);
  });

  it('Resolve by commit: every keyword form, in any case, with or without a colon', () => {
    for (const word of KEYWORDS) {
      expect(fixedShortIds(`${word} NW-2`)).toEqual(['NW-2']);
      expect(fixedShortIds(`${word.toUpperCase()}: NW-2`)).toEqual(['NW-2']);
    }
  });

  it('Resolve by commit: a list separated by commas, spaces or "and" names every id once, in order', () => {
    expect(fixedShortIds('Closes NW-1, NW-2 NW-3 and NW-4, and NW-5')).toEqual(['NW-1', 'NW-2', 'NW-3', 'NW-4', 'NW-5']);
    expect(fixedShortIds('fixes NW-1; resolves NW-2 and NW-1')).toEqual(['NW-1', 'NW-2']);
  });

  it('Resolve by commit: words that only contain a keyword, or ids without one, name nothing', () => {
    expect(fixedShortIds('prefix NW-1')).toEqual([]);
    expect(fixedShortIds('suffixes NW-1')).toEqual([]);
    expect(fixedShortIds('fixesNW-1')).toEqual([]);
    expect(fixedShortIds('see NW-1, related to NW-2')).toEqual([]);
    expect(fixedShortIds('fix the bug in NW-1')).toEqual([]);
  });

  it('Resolve by commit: an id must be the whole token, in capitals, with a base32 suffix', () => {
    expect(fixedShortIds('fixes nw-1a')).toEqual([]);
    expect(fixedShortIds('fixes NW-1Ab')).toEqual([]);
    expect(fixedShortIds('fixes NW-1A-2')).toEqual([]);
    expect(fixedShortIds('fixes NW-IO')).toEqual([]);
    expect(fixedShortIds('fixes NW-1 and the rest')).toEqual(['NW-1']);
  });

  it('any generated reference sentence names its ids', () => {
    fc.assert(
      fc.property(
        fc.string(),
        keyword,
        lead,
        fc.array(shortId, { minLength: 1, maxLength: 5 }),
        separator,
        tail,
        (prefix, word, l, ids, sep, t) => {
          const found = fixedShortIds(`${prefix} ${word}${l}${ids.join(sep)}${t}`);
          for (const id of ids) expect(found).toContain(id);
        },
      ),
    );
  });

  it('text with no keyword names nothing', () => {
    fc.assert(
      fc.property(fc.string(), fc.array(shortId), (text, ids) => {
        const body = `${text} ${ids.join(', ')}`;
        fc.pre(!/fix|close|resolve/i.test(body));
        expect(fixedShortIds(body)).toEqual([]);
      }),
    );
  });

  it('every id named is a Short Id', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        for (const id of fixedShortIds(`fixes ${text}`)) expect(isShortId(id)).toBe(true);
      }),
    );
  });
});
