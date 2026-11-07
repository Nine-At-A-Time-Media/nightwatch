/**
 * viewIssue -- a Member opens one Issue in the console (design Issues,
 * Summary; Reports, Thread and Evidence). It shows the Issue, its latest
 * Event's title and culprit, every Comment on it, shared or private, and its
 * External Link. The caller has already signed the Member in to the Project
 * (signInMember). Ports: ProjectClient.
 */

import type { IssueId, ProjectId } from '../../domain/ids.js';
import { issueNotFound, type IssueState } from '../../domain/issue/state.js';
import type { Refusal } from '../../domain/refusal.js';
import type { Comment } from '../../domain/report/thread.js';
import type { ExternalLink } from '../../domain/tracker/external-link.js';
import type { ProjectClient } from '../../ports/project-client.js';

export type ViewIssueDeps = { projects: ProjectClient };

/** One Issue as the console's detail page shows it to a Member. */
export type IssueView = {
  readonly state: IssueState;
  readonly title: string | null;
  readonly culprit: string | null;
  readonly comments: readonly Comment[];
  readonly externalLink: ExternalLink | null;
};

// --- exports ---

export async function viewIssue(project: ProjectId, issue: IssueId, deps: ViewIssueDeps): Promise<IssueView | Refusal> {
  const state = await deps.projects.getIssue(project, issue);
  if (state === null) return issueNotFound();
  const latest = await deps.projects.latestEventOf(project, issue);
  const comments = await deps.projects.commentsOn(project, issue);
  const externalLink = await deps.projects.externalLinkOf(project, issue);
  return { state, title: latest?.title ?? null, culprit: latest?.culprit ?? null, comments, externalLink };
}
