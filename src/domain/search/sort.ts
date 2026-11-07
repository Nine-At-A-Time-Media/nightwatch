/**
 * Search sort keys -- the orders an Issue Page can take: `date` (last seen),
 * `new` (first seen), `freq` (event count), `user` (affected users) and
 * `priority`. Every order is highest first, with ties broken by Issue Id
 * ascending, so it is total: no two Issues share a place, and a Cursor can
 * name exactly where a page ended.
 */

import type { IssueId } from '../ids.js';
import type { PriorityLevel } from '../issue/priority.js';
import type { IssueFacts } from './match.js';

export const ISSUE_SORTS = ['date', 'new', 'freq', 'user', 'priority'] as const;
export type IssueSort = (typeof ISSUE_SORTS)[number];

/** Where an Issue falls in a sort order. */
export type SortPosition = { readonly key: number; readonly issueId: IssueId };

const PRIORITY_RANK: Readonly<Record<PriorityLevel, number>> = { low: 0, medium: 1, high: 2 };

// --- predicates ---

export function isIssueSort(value: string): value is IssueSort {
  return (ISSUE_SORTS as readonly string[]).includes(value);
}

// --- helpers ---

function sortKeyOf(issue: IssueFacts, sort: IssueSort): number {
  switch (sort) {
    case 'date':
      return issue.state.lastSeen;
    case 'new':
      return issue.state.firstSeen;
    case 'freq':
      return issue.state.count;
    case 'user':
      return issue.state.userCount;
    case 'priority':
      return PRIORITY_RANK[issue.state.priority.level];
  }
}

// --- exports ---

export function sortPositionOf(issue: IssueFacts, sort: IssueSort): SortPosition {
  return { key: sortKeyOf(issue, sort), issueId: issue.state.issueId };
}

/** Negative when `a` comes first: the higher key, then the lower Issue Id. */
export function compareForSort(a: SortPosition, b: SortPosition): number {
  if (a.key !== b.key) return a.key > b.key ? -1 : 1;
  if (a.issueId === b.issueId) return 0;
  return a.issueId < b.issueId ? -1 : 1;
}
