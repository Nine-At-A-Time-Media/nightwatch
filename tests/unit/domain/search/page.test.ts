import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { issuePage, mergePages, planSearch, type IssuePage, type SearchPlan } from '../../../../src/domain/search/page.js';
import { parseIssueQuery } from '../../../../src/domain/search/parse.js';
import { encodeCursor } from '../../../../src/domain/search/cursor.js';
import { ISSUE_SORTS, type IssueSort } from '../../../../src/domain/search/sort.js';
import type { IssueQuery } from '../../../../src/domain/search/query.js';
import type { Cursor } from '../../../../src/domain/search/cursor.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { context, DAY, facts, NOW } from './fixtures.js';

function parsed(text: string): IssueQuery {
  const query = parseIssueQuery(text);
  if (isRefusal(query)) throw new Error(query.refusal);
  return query;
}

function plan(request: { query: IssueQuery; sort: IssueSort; cursor: Cursor | null; limit: number }): SearchPlan {
  const result = planSearch(request);
  if (isRefusal(result)) throw new Error(result.refusal);
  return result;
}

function ids(page: IssuePage): readonly string[] {
  return page.issues.map((issue) => issue.state.issueId);
}

/** Issues across projects, with ids unique across all of them, some of them resolved. */
const projects = fc
  .array(
    fc.array(
      fc.record({
        lastSeen: fc.integer({ min: 0, max: 20 }),
        count: fc.integer({ min: 1, max: 5 }),
        resolved: fc.boolean(),
      }),
      { maxLength: 8 },
    ),
    { minLength: 1, maxLength: 4 },
  )
  .map((perProject) =>
    perProject.map((issues, p) =>
      issues.map((issue, i) =>
        facts(
          {},
          {
            issueId: `p${p}-i${i}`,
            lastSeen: NOW - issue.lastSeen * DAY,
            count: issue.count,
            ...(issue.resolved ? { status: { status: 'resolved', resolution: { kind: 'plain' } } } : {}),
          },
        ),
      ),
    ),
  );

const sort = fc.constantFrom<IssueSort>(...ISSUE_SORTS);
const unresolved = parsed('is:unresolved');

/** Every page of one search, following each next Cursor until there is none. */
function walk(request: { pages: (plan: SearchPlan) => IssuePage; query: IssueQuery; sort: IssueSort; limit: number }): string[] {
  const seen: string[] = [];
  let cursor: Cursor | null = null;
  for (let step = 0; step < 100; step++) {
    const page = request.pages(plan({ query: request.query, sort: request.sort, cursor, limit: request.limit }));
    seen.push(...ids(page));
    if (page.next === null) return seen;
    cursor = page.next;
  }
  throw new Error('paging did not end');
}

describe('planSearch', () => {
  it('reads the Cursor into the position the next page starts after', () => {
    const cursor = encodeCursor({ sort: 'freq', lastKey: 7, lastId: 'issue-3', query: unresolved });
    expect(planSearch({ query: unresolved, sort: 'freq', cursor, limit: 25 })).toEqual({
      query: unresolved,
      sort: 'freq',
      after: { sort: 'freq', lastKey: 7, lastId: 'issue-3' },
      limit: 25,
    });
  });

  it('refuses a Cursor from another query, and a limit that is not a positive whole number', () => {
    const cursor = encodeCursor({ sort: 'freq', lastKey: 7, lastId: 'issue-3', query: parsed('is:resolved') });
    expect(planSearch({ query: unresolved, sort: 'freq', cursor, limit: 25 })).toEqual({ refusal: 'search_cursor_mismatch' });
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      expect(planSearch({ query: unresolved, sort: 'date', cursor: null, limit })).toEqual({ refusal: 'search_bad_limit' });
    }
  });
});

describe('issuePage', () => {
  it('returns the matching issues in sort order, up to the limit, with a Cursor to the rest', () => {
    const issues = [
      facts({}, { issueId: 'a', count: 5 }),
      facts({}, { issueId: 'b', count: 9 }),
      facts({}, { issueId: 'c', count: 9, status: { status: 'resolved', resolution: { kind: 'plain' } } }),
      facts({}, { issueId: 'd', count: 1 }),
    ];
    const first = issuePage(issues, plan({ query: unresolved, sort: 'freq', cursor: null, limit: 2 }), context);
    expect(ids(first)).toEqual(['b', 'a']);
    expect(first.next).not.toBeNull();
    const second = issuePage(issues, plan({ query: unresolved, sort: 'freq', cursor: first.next, limit: 2 }), context);
    expect(second).toEqual({ issues: [issues[3]], next: null });
  });

  it('pages through every matching issue exactly once, in sort order', () => {
    fc.assert(
      fc.property(projects, sort, fc.integer({ min: 1, max: 5 }), (perProject, s, limit) => {
        const all = perProject.flat();
        const expected = issuePage(all, plan({ query: unresolved, sort: s, cursor: null, limit: all.length + 1 }), context);
        expect(walk({ pages: (p) => issuePage(all, p, context), query: unresolved, sort: s, limit })).toEqual(ids(expected));
      }),
    );
  });
});

describe('mergePages', () => {
  it("Cross-tenant search: Given issues in two Organizations, When a member of one searches, Then no issue from the other is returned -- the merge returns only issues its Projects' pages hold", () => {
    fc.assert(
      fc.property(projects, sort, fc.integer({ min: 1, max: 5 }), (perProject, s, limit) => {
        const p = plan({ query: unresolved, sort: s, cursor: null, limit });
        const pages = perProject.map((issues) => issuePage(issues, p, context));
        const offered = new Set(pages.flatMap(ids));
        const merged = mergePages({ pages, plan: p });
        expect(ids(merged).every((id) => offered.has(id))).toBe(true);
        expect(merged.issues.length).toBeLessThanOrEqual(limit);
      }),
    );
  });

  it('merges per-Project pages into the same pages one search over every Project would give', () => {
    fc.assert(
      fc.property(projects, sort, fc.integer({ min: 1, max: 5 }), (perProject, s, limit) => {
        const all = perProject.flat();
        const fanOut = (p: SearchPlan) => mergePages({ pages: perProject.map((issues) => issuePage(issues, p, context)), plan: p });
        const single = (p: SearchPlan) => issuePage(all, p, context);
        expect(walk({ pages: fanOut, query: unresolved, sort: s, limit })).toEqual(
          walk({ pages: single, query: unresolved, sort: s, limit }),
        );
      }),
    );
  });

  it('returns an issue offered twice once, and an empty page with no Cursor when no Project has one', () => {
    const p = plan({ query: unresolved, sort: 'date', cursor: null, limit: 5 });
    const one = facts({}, { issueId: 'a' });
    expect(
      ids(
        mergePages({
          pages: [
            { issues: [one], next: null },
            { issues: [one], next: null },
          ],
          plan: p,
        }),
      ),
    ).toEqual(['a']);
    expect(mergePages({ pages: [], plan: p })).toEqual({ issues: [], next: null });
  });
});
