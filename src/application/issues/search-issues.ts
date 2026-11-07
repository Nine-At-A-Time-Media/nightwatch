/**
 * searchIssues -- the console's Issue search (design Behaviors: Search,
 * Cross-tenant search; architecture Mechanism: search sends one plan to
 * each Project and merges the pages by sort key with a Cursor).
 *
 * The viewer's Organization comes from their Membership, and only that
 * Organization's Projects are asked: that choice is what keeps
 * Organizations apart. The search context carries the viewer's address
 * (for `assigned:me`), the Organization's newest Release (for
 * `release:latest`, over every Project's first-seen Releases) and the time.
 * Pages are sorted by last seen, a fixed number of Issues per page.
 *
 * Ports: ControlStore, ProjectClient, Clock.
 */

import type { OrganizationId, ProjectId } from '../../domain/ids.js';
import type { Member } from '../../domain/issue/state.js';
import { isRefusal, refusal, type Refusal } from '../../domain/refusal.js';
import { latestReleaseOf, type Release, type ReleaseFirstSeen } from '../../domain/release/ordering.js';
import type { Cursor } from '../../domain/search/cursor.js';
import type { SearchContext } from '../../domain/search/match.js';
import { mergePages, planSearch, type IssuePage, type SearchPlan } from '../../domain/search/page.js';
import type { IssueQuery } from '../../domain/search/query.js';
import type { IssueSort } from '../../domain/search/sort.js';
import type { Clock } from '../../ports/clock.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { ProjectClient } from '../../ports/project-client.js';

export type SearchIssuesDeps = { control: ControlStore; projects: ProjectClient; clock: Clock };

/** The order an Issue Page takes: most recently seen first. */
const SEARCH_SORT: IssueSort = 'date';
/** Issues per page. */
const SEARCH_PAGE_LIMIT = 25;

// --- helpers ---

/** The Organization's first-seen Releases: each Release at the earliest any of its Projects saw it. */
function organizationFirstSeen(perProject: readonly ReleaseFirstSeen[]): ReleaseFirstSeen {
  const combined = new Map<Release, number>();
  for (const [release, at] of perProject.flatMap((firstSeen) => [...firstSeen])) {
    combined.set(release, Math.min(at, combined.get(release) ?? at));
  }
  return combined;
}

// --- flow ---

async function searchContext(scope: { viewer: Member; projectIds: readonly ProjectId[] }, deps: SearchIssuesDeps): Promise<SearchContext> {
  const firstSeen = await Promise.all(scope.projectIds.map((projectId) => deps.projects.releasesSeen(projectId)));
  return {
    viewerEmail: (await deps.control.addressOf(scope.viewer)) ?? '',
    latestRelease: latestReleaseOf(organizationFirstSeen(firstSeen)),
    now: deps.clock.now(),
  };
}

async function searchOrganization(
  search: { organizationId: OrganizationId; viewer: Member; plan: SearchPlan },
  deps: SearchIssuesDeps,
): Promise<IssuePage> {
  const projectIds = await deps.control.projectsOf(search.organizationId);
  const context = await searchContext({ viewer: search.viewer, projectIds }, deps);
  const pages = await Promise.all(projectIds.map((projectId) => deps.projects.searchPage(projectId, search.plan, context)));
  return mergePages({ pages, plan: search.plan });
}

// --- exports ---

/** One page of the viewer's Organization's Issues matching the query, after the Cursor; refused for a non-member or a foreign Cursor. */
export async function searchIssues(
  query: IssueQuery,
  viewer: Member,
  cursor: Cursor | null,
  deps: SearchIssuesDeps,
): Promise<IssuePage | Refusal> {
  const membership = await deps.control.membershipOf(viewer);
  if (membership === null) return refusal('not_a_member');
  const plan = planSearch({ query, sort: SEARCH_SORT, cursor, limit: SEARCH_PAGE_LIMIT });
  if (isRefusal(plan)) return plan;
  return searchOrganization({ organizationId: membership.organizationId, viewer, plan }, deps);
}
