/**
 * listIssues -- a Member lists one Project's Issues in the console (design
 * Issues, Summary). A stand-in for searchIssues until it lands: no Issue
 * Query and no Cursor, every Issue the Project holds, last seen first, each
 * with its latest Event's title and culprit (none for a Report issue that
 * holds no Event). The caller has already signed the Member in to the
 * Project (signInMember). Ports: ProjectClient.
 */

import type { ProjectId } from '../../domain/ids.js';
import type { IssueState } from '../../domain/issue/state.js';
import type { ProjectClient } from '../../ports/project-client.js';

export type ListIssuesDeps = { projects: ProjectClient };

/** One Issue as the console's list shows it. */
export type IssueListEntry = { readonly state: IssueState; readonly title: string | null; readonly culprit: string | null };

// --- helpers ---

function lastSeenFirst(a: IssueListEntry, b: IssueListEntry): number {
  return b.state.lastSeen - a.state.lastSeen;
}

// --- flow ---

async function entryOf(projectId: ProjectId, state: IssueState, projects: ProjectClient): Promise<IssueListEntry> {
  const latest = await projects.latestEventOf(projectId, state.issueId);
  return { state, title: latest?.title ?? null, culprit: latest?.culprit ?? null };
}

// --- exports ---

export async function listIssues(project: ProjectId, deps: ListIssuesDeps): Promise<IssueListEntry[]> {
  const entries: IssueListEntry[] = [];
  for (const state of await deps.projects.listIssues(project)) entries.push(await entryOf(project, state, deps.projects));
  return entries.sort(lastSeenFirst);
}
