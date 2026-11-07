import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { compareForSort, sortPositionOf, ISSUE_SORTS, type IssueSort } from '../../../../src/domain/search/sort.js';
import { decodeCursor, encodeCursor } from '../../../../src/domain/search/cursor.js';
import { parseIssueQuery } from '../../../../src/domain/search/parse.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import type { IssueQuery } from '../../../../src/domain/search/query.js';
import { DAY, facts, NOW } from './fixtures.js';

function parsed(text: string): IssueQuery {
  const query = parseIssueQuery(text);
  if (isRefusal(query)) throw new Error(query.refusal);
  return query;
}

const query = parsed('is:unresolved assigned:me');
const sort = fc.constantFrom<IssueSort>(...ISSUE_SORTS);
const position = fc.record({
  sort,
  lastKey: fc.integer({ min: -(2 ** 52), max: 2 ** 52 }),
  lastId: fc.string({ minLength: 1, maxLength: 40 }),
});

describe('sort keys', () => {
  it('orders by the chosen key, highest first', () => {
    const older = facts({}, { issueId: 'a', firstSeen: NOW - 3 * DAY, lastSeen: NOW - DAY, count: 50, userCount: 1 });
    const newer = facts(
      {},
      { issueId: 'b', firstSeen: NOW - DAY, lastSeen: NOW, count: 5, userCount: 9, priority: { level: 'high', setByHand: false } },
    );
    const before = (s: IssueSort) => compareForSort(sortPositionOf(older, s), sortPositionOf(newer, s)) < 0;
    expect({ date: before('date'), new: before('new'), freq: before('freq'), user: before('user'), priority: before('priority') }).toEqual({
      date: false,
      new: false,
      freq: true,
      user: false,
      priority: false,
    });
  });

  it('breaks ties on Issue Id, so the order is total and stable', () => {
    fc.assert(
      fc.property(fc.integer(), fc.string(), fc.string(), (key, a, b) => {
        const left = { key, issueId: a };
        const right = { key, issueId: b };
        expect(Math.sign(compareForSort(left, right))).toBe(a === b ? 0 : a < b ? -1 : 1);
        expect(Math.sign(compareForSort(left, right))).toBe(-Math.sign(compareForSort(right, left)));
      }),
    );
  });
});

describe('Cursor', () => {
  it('decodes what it encodes, for the query and sort that issued it', () => {
    fc.assert(
      fc.property(position, (p) => {
        const cursor = encodeCursor({ ...p, query });
        expect(cursor).toMatch(/^[A-Za-z0-9_.-]+$/);
        expect(decodeCursor({ cursor, query, sort: p.sort })).toEqual(p);
      }),
    );
  });

  it('refuses a Cursor issued for another query or another sort', () => {
    const cursor = encodeCursor({ sort: 'date', lastKey: NOW, lastId: 'issue-9', query });
    expect(decodeCursor({ cursor, query: parsed('is:unresolved'), sort: 'date' })).toEqual({ refusal: 'search_cursor_mismatch' });
    expect(decodeCursor({ cursor, query, sort: 'freq' })).toEqual({ refusal: 'search_cursor_mismatch' });
  });

  it('refuses tampered or malformed input', () => {
    const cursor = encodeCursor({ sort: 'date', lastKey: NOW, lastId: 'issue-9', query });
    const [body = '', check = ''] = cursor.split('.');
    const flipped = `${body.slice(0, -1)}${body.endsWith('A') ? 'B' : 'A'}.${check}`;
    for (const bad of ['', 'x', `${body}.`, `${body}.000000000000`, flipped, `${cursor}x`, '%%%.abc', 'a'.repeat(5000)]) {
      expect(decodeCursor({ cursor: bad, query, sort: 'date' })).toEqual({ refusal: 'search_bad_cursor' });
    }
  });

  it('refuses any string that is not a Cursor it issued', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (text) => {
        expect(decodeCursor({ cursor: text, query, sort: 'date' })).toEqual({ refusal: 'search_bad_cursor' });
      }),
    );
  });
});
