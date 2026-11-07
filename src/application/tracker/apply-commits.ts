/**
 * applyCommits -- the github runtime records Commits from push events,
 * merged pull requests or a release range (design Behaviors: Resolve by
 * commit; Code and GitHub, Resolve by reference and Commits).
 *
 * A Commit counts only in a Repository an Organization connected. Each Short
 * Id its message says it fixes resolves that Issue with a pending commit
 * Resolution, in the Project of that Organization whose slug the Short Id
 * carries; an unknown slug or Short Id, or an Issue the command does not
 * allow, changes nothing. A Commit known to ship in a Release then names it
 * in every pending Resolution of the Organization's Projects that waits for
 * that Commit. Returns the Issue Changes made, which the Projects enqueue.
 * Ports: ControlStore, ProjectClient, Clock.
 */

import type { OrganizationId } from '../../domain/ids.js';
import { shortIdNumber, type ShortId } from '../../domain/issue/short-id.js';
import type { IssueChange } from '../../domain/issue/state.js';
import { isRefusal } from '../../domain/refusal.js';
import { commitKey, type Commit } from '../../domain/release/commit.js';
import { fixedShortIds } from '../../domain/release/commit-references.js';
import type { Clock } from '../../ports/clock.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { ProjectClient } from '../../ports/project-client.js';

export type ApplyCommitsDeps = { control: ControlStore; projects: ProjectClient; clock: Clock };

// --- helpers ---

/** The Project slug a Short Id carries: everything before its last dash. */
function slugOf(shortId: ShortId): string {
  return shortId.slice(0, shortId.lastIndexOf('-'));
}

// --- flow: one Commit ---

async function resolveFixed(commit: Commit, organizationId: OrganizationId, deps: ApplyCommitsDeps): Promise<IssueChange[]> {
  const changes: IssueChange[] = [];
  for (const shortId of fixedShortIds(commit.message)) {
    const projectId = await deps.control.projectOfSlug({ organizationId, slug: slugOf(shortId) });
    if (projectId === null) continue;
    const fix = { shortId: shortIdNumber(shortId), commit: commitKey(commit), at: deps.clock.now() };
    const resolved = await deps.projects.resolveByCommit(projectId, fix);
    if (!isRefusal(resolved)) changes.push(...resolved);
  }
  return changes;
}

async function nameShipped(commit: Commit, organizationId: OrganizationId, deps: ApplyCommitsDeps): Promise<IssueChange[]> {
  if (commit.release === null) return [];
  const changes: IssueChange[] = [];
  for (const projectId of await deps.control.projectsOf(organizationId)) {
    changes.push(
      ...(await deps.projects.recordCommitShipped(projectId, { commit: commitKey(commit), release: commit.release, at: deps.clock.now() })),
    );
  }
  return changes;
}

async function applyCommit(commit: Commit, deps: ApplyCommitsDeps): Promise<IssueChange[]> {
  const organizationId = await deps.control.organizationOfRepository(commit.repository);
  if (organizationId === null) return [];
  const resolved = await resolveFixed(commit, organizationId, deps);
  return [...resolved, ...(await nameShipped(commit, organizationId, deps))];
}

// --- exports ---

export async function applyCommits(commits: Commit[], deps: ApplyCommitsDeps): Promise<IssueChange[]> {
  const changes: IssueChange[] = [];
  for (const commit of commits) changes.push(...(await applyCommit(commit, deps)));
  return changes;
}
