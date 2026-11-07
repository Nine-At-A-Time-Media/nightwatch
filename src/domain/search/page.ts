/**
 * Search plan and Issue Page -- how one search runs across the viewer's
 * Projects (architecture Mechanism: search sends the plan to each Project
 * and merges the pages by sort key with a Cursor).
 *
 * planSearch turns a request into a SearchPlan, the same for every Project.
 * issuePage runs the plan over one Project's Issues. mergePages joins the
 * Projects' pages into one. Each Project returns its own first `limit`
 * Issues after the Cursor, so the first `limit` of their union is the first
 * `limit` overall: merging per-Project pages gives the same pages as one
 * search over every Issue would. The merge only selects among the Issues
 * the pages hold; it never adds one. Which Projects are asked is the use
 * case's decision, and that is where Organizations are kept apart.
 */

import { isRefusal, refusal, type Refusal } from '../refusal.js';
import { decodeCursor, encodeCursor, type Cursor, type CursorPosition } from './cursor.js';
import { matchesQuery, type IssueFacts, type SearchContext } from './match.js';
import type { IssueQuery } from './query.js';
import { compareForSort, sortPositionOf, type IssueSort } from './sort.js';

/** One search, as every Project runs it: return up to `limit` matching Issues after `after`. */
export type SearchPlan = {
  readonly query: IssueQuery;
  readonly sort: IssueSort;
  /** Where the previous page ended; null for the first page. */
  readonly after: CursorPosition | null;
  readonly limit: number;
};

/** Issues in sort order, and the Cursor to the next page, null when there is none. */
export type IssuePage = { readonly issues: readonly IssueFacts[]; readonly next: Cursor | null };

// --- predicates ---

function isAfter({ issue, plan }: { issue: IssueFacts; plan: SearchPlan }): boolean {
  if (plan.after === null) return true;
  return compareForSort(sortPositionOf(issue, plan.sort), { key: plan.after.lastKey, issueId: plan.after.lastId }) > 0;
}

// --- helpers ---

function sorted({ issues, sort }: { issues: readonly IssueFacts[]; sort: IssueSort }): readonly IssueFacts[] {
  return [...issues].sort((a, b) => compareForSort(sortPositionOf(a, sort), sortPositionOf(b, sort)));
}

/** The first `limit` of Issues already in order, with a Cursor after the last when `more` follow. */
function cut({ ordered, plan, more }: { ordered: readonly IssueFacts[]; plan: SearchPlan; more: boolean }): IssuePage {
  const issues = ordered.slice(0, plan.limit);
  const last = issues.at(-1);
  if (last === undefined || !(more || ordered.length > plan.limit)) return { issues, next: null };
  const { key, issueId } = sortPositionOf(last, plan.sort);
  return { issues, next: encodeCursor({ sort: plan.sort, lastKey: key, lastId: issueId, query: plan.query }) };
}

/** One of each Issue, by Issue Id. */
function distinct(issues: readonly IssueFacts[]): readonly IssueFacts[] {
  return [...new Map(issues.map((issue) => [issue.state.issueId, issue])).values()];
}

// --- exports ---

/** The plan for a search request, or a Refusal for a bad limit or a Cursor this query and sort did not issue. */
export function planSearch(request: { query: IssueQuery; sort: IssueSort; cursor: Cursor | null; limit: number }): SearchPlan | Refusal {
  const { query, sort, cursor, limit } = request;
  if (!Number.isSafeInteger(limit) || limit < 1) return refusal('search_bad_limit');
  const after = cursor === null ? null : decodeCursor({ cursor, query, sort });
  if (isRefusal(after)) return after;
  return { query, sort, after, limit };
}

/** One Project's page: its Issues that match the plan's query, after its Cursor, in sort order, up to its limit. */
export function issuePage(issues: readonly IssueFacts[], plan: SearchPlan, context: SearchContext): IssuePage {
  const candidates = issues.filter((issue) => isAfter({ issue, plan }) && matchesQuery(plan.query, issue, context));
  return cut({ ordered: sorted({ issues: candidates, sort: plan.sort }), plan, more: false });
}

/** The page across Projects: the first `limit` of the Projects' pages, in sort order, with a Cursor to the rest. */
export function mergePages({ pages, plan }: { pages: readonly IssuePage[]; plan: SearchPlan }): IssuePage {
  const ordered = sorted({ issues: distinct(pages.flatMap((page) => page.issues)), sort: plan.sort });
  return cut({ ordered, plan, more: pages.some((page) => page.next !== null) });
}
