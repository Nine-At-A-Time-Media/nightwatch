/**
 * searchProjectPage -- one Project's page of a search, run where the
 * Project's state lives (ProjectDO, or an in-process store in tests). The
 * Issue facts are read from the IssueStore and the plan is applied by the
 * search domain. The caller names the slug the Project's Short Ids carry,
 * since the slug is kept in the ControlStore, which ProjectDO does not reach.
 */

import type { Assignee } from '../../domain/alerts/issue-alert-rule.js';
import type { EventSummary } from '../../domain/event/event-summary.js';
import type { ProjectId } from '../../domain/ids.js';
import type { Level } from '../../domain/issue/priority.js';
import { formatShortId } from '../../domain/issue/short-id.js';
import type { IssueState } from '../../domain/issue/state.js';
import type { AssigneeFacts, IssueFacts, SearchContext } from '../../domain/search/match.js';
import { issuePage, type IssuePage, type SearchPlan } from '../../domain/search/page.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type SearchProjectPageDeps = {
  readonly issues: IssueStore;
  /** The address of each Member the Project knows, so `assigned:me` can match; absent Members show their id. */
  readonly memberEmails: ReadonlyMap<string, string>;
};

// --- helpers ---

/** The values of an Event Summary field, once each, leaving out absent ones. */
function distinctOf(values: readonly (string | null)[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

function latestOf(events: readonly EventSummary[]): EventSummary | null {
  return events.reduce<EventSummary | null>((last, event) => (last && last.at > event.at ? last : event), null);
}

function assigneeFacts(assignee: Assignee | null, memberEmails: ReadonlyMap<string, string>): AssigneeFacts | null {
  if (assignee === null) return null;
  if ('team' in assignee) return { team: assignee.team };
  return { memberEmail: memberEmails.get(assignee.member) ?? assignee.member };
}

// --- flow ---

/** The facts search reads about one Issue. Tags are not stored per Issue yet, so none match. */
export async function issueFactsOf(
  project: { projectId: ProjectId; slug: string },
  state: IssueState,
  deps: SearchProjectPageDeps,
): Promise<IssueFacts> {
  const { issues } = deps;
  const events = (await issues.eventsOf(state.issueId)).map((event) => event.summary);
  const latest = latestOf(events);
  const level: Level = latest?.level ?? 'error';
  return {
    projectId: project.projectId,
    state,
    shortId: formatShortId({ slug: project.slug, counter: (await issues.shortIdOf(state.issueId)) ?? 0 }),
    title: latest?.title ?? '',
    culprit: latest?.culprit ?? '',
    level,
    assignee: assigneeFacts(await issues.assigneeOf(state.issueId), deps.memberEmails),
    releases: distinctOf(events.map((event) => event.release)),
    environments: distinctOf(events.map((event) => event.environment)),
    tags: new Map(),
    reportCount: (await issues.reportsOn(state.issueId)).length,
    linked: (await issues.externalLinkOf(state.issueId)) !== null,
  };
}

export async function searchProjectPage(
  projectId: ProjectId,
  search: { plan: SearchPlan; context: SearchContext; slug: string },
  deps: SearchProjectPageDeps,
): Promise<IssuePage> {
  const states = await deps.issues.listIssues();
  const facts = await Promise.all(states.map((state) => issueFactsOf({ projectId, slug: search.slug }, state, deps)));
  return issuePage(facts, search.plan, search.context);
}
