/**
 * viewIssue -- a Member opens one Issue in the console (design Issues,
 * Summary; Reports, Thread and Evidence). It shows the Issue, its latest
 * Event's title and culprit, every Comment on it, shared or private, and its
 * External Link, and its Short Id spelled with the Project's slug. The caller
 * has already signed the Member in to the Project (signInMember). Ports:
 * ProjectClient, ControlStore.
 */

import type { IssueId, ProjectId } from '../../domain/ids.js';
import { formatShortId, shortIdSlug, type ShortId } from '../../domain/issue/short-id.js';
import { issueNotFound, type IssueState } from '../../domain/issue/state.js';
import type { Refusal } from '../../domain/refusal.js';
import type { Comment } from '../../domain/report/thread.js';
import type { ExternalLink } from '../../domain/tracker/external-link.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { ProjectClient } from '../../ports/project-client.js';

export type ViewIssueDeps = { projects: ProjectClient; control: ControlStore };

/** One Issue as the console's detail page shows it to a Member. */
export type IssueView = {
  readonly state: IssueState;
  readonly shortId: ShortId;
  readonly title: string | null;
  readonly culprit: string | null;
  readonly comments: readonly Comment[];
  readonly externalLink: ExternalLink | null;
};

// --- flow ---

async function shortIdOf(project: ProjectId, issue: IssueId, deps: ViewIssueDeps): Promise<ShortId> {
  const slug = shortIdSlug({ projectId: project, slug: await deps.control.slugOfProject(project) });
  return formatShortId({ slug, counter: (await deps.projects.shortIdOf(project, issue)) ?? 0 });
}

// --- exports ---

export async function viewIssue(project: ProjectId, issue: IssueId, deps: ViewIssueDeps): Promise<IssueView | Refusal> {
  const state = await deps.projects.getIssue(project, issue);
  if (state === null) return issueNotFound();
  const latest = await deps.projects.latestEventOf(project, issue);
  const comments = await deps.projects.commentsOn(project, issue);
  const externalLink = await deps.projects.externalLinkOf(project, issue);
  const shortId = await shortIdOf(project, issue, deps);
  return { state, shortId, title: latest?.title ?? null, culprit: latest?.culprit ?? null, comments, externalLink };
}
