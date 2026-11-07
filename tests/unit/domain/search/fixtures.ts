// Search fixtures: Issue facts and a search context as plain values.
import type { IssueStateBase, Status } from '../../../../src/domain/issue/state.js';
import type { IssueFacts, SearchContext } from '../../../../src/domain/search/match.js';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const NOW = Date.UTC(2026, 10, 7);

export const context: SearchContext = { viewerEmail: 'ana@example.com', latestRelease: 'web@2.0.0', now: NOW };

const unresolved: Status = { status: 'unresolved', substatus: 'ongoing' };

/** An ongoing, unassigned Issue first seen two days ago and last seen an hour ago. */
export function facts(
  overrides: Partial<Omit<IssueFacts, 'state'>> = {},
  state: Partial<IssueStateBase> & { status?: Status } = {},
): IssueFacts {
  const { status = unresolved, ...base } = state;
  return {
    state: {
      issueId: 'issue-1',
      substatusSince: NOW - 2 * DAY,
      firstSeen: NOW - 2 * DAY,
      lastSeen: NOW - HOUR,
      count: 12,
      userCount: 3,
      priority: { level: 'medium', setByHand: false },
      forReviewSince: null,
      ...base,
      ...status,
    },
    shortId: 'WEB-3K',
    title: 'TypeError: cannot read properties of undefined',
    culprit: 'app/checkout/cart.ts in total',
    level: 'error',
    assignee: null,
    releases: ['web@1.9.0'],
    environments: ['production'],
    tags: new Map([
      ['browser', ['Firefox 131', 'Chrome 130']],
      ['os.name', ['Linux']],
    ]),
    reportCount: 0,
    linked: false,
    ...overrides,
  };
}
