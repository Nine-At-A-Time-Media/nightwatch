/**
 * suggestOwners -- the github runtime suggests owners for a new Issue
 * (design Behaviors: Owner suggested; Suspect commit; Issues, Ownership;
 * Code and GitHub, Suspect commit, Code links and CODEOWNERS).
 *
 * The Project's Ownership Rules are matched against the Event. The topmost
 * in-app frame is placed in a Repository through the Project's Code
 * Mappings; when that Repository is connected to the Organization, its
 * CODEOWNERS file (`.github/`, the root, then `docs/`) names owners for the
 * file, and a blame of the frame's line names the commit that last changed
 * it, which is the Suspect Commit when it falls inside the Suspect Commit
 * Window. Owners map to Members and Teams through the Organization's
 * accounts: an address, a tracker login, a tracker team; one that maps to
 * none is dropped. A code host that refuses costs only what it would have
 * told. When the Project auto-assigns and the Issue has no Assignee, the
 * first owner is assigned by Nightwatch itself. Ports: ControlStore,
 * CodeHost, ProjectClient. The Project is named beside the Issue, which does
 * not carry it; the Event Summary arrives with the Event's ownership facts.
 */

import type { Assignee } from '../../domain/alerts/issue-alert-rule.js';
import type { IssueId, OrganizationId, ProjectId } from '../../domain/ids.js';
import { repositoryPathOf, type RepositoryPath } from '../../domain/ownership/code-mapping.js';
import { ownersByCodeowners, parseCodeowners } from '../../domain/ownership/codeowners.js';
import type { OwnershipSettings } from '../../domain/ownership/config.js';
import type { OwnedEventSummary } from '../../domain/ownership/facts.js';
import type { OwnerRef } from '../../domain/ownership/owner.js';
import {
  autoAssignee,
  rankedOwners,
  type OwnerSource,
  type OwnerSuggestion,
  type SuggestedOwner,
} from '../../domain/ownership/owner-suggestion.js';
import { ownersByRules, parseOwnershipRules } from '../../domain/ownership/ownership-rules.js';
import { isWithinWindow, topInAppFrame, type SuspectCommit } from '../../domain/ownership/suspect-commit.js';
import { isRefusal } from '../../domain/refusal.js';
import type { CodeHost } from '../../ports/code-host.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { ProjectClient } from '../../ports/project-client.js';

export type SuggestOwnersDeps = { control: ControlStore; codeHost: CodeHost; projects: ProjectClient; settings: OwnershipSettings };

/** Where GitHub looks for a CODEOWNERS file, in its order. */
const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

type Located = RepositoryPath & { readonly line: number };

// --- flow: account mapping ---

async function assigneeOf(organizationId: OrganizationId, ref: OwnerRef, control: ControlStore): Promise<Assignee | null> {
  switch (ref.kind) {
    case 'team':
      return { team: ref.team };
    case 'email':
      return control.memberOfAddress({ organizationId, email: ref.email });
    case 'login':
      return control.memberOfTrackerAccount({ organizationId, login: ref.login });
    case 'tracker_team': {
      const team = await control.teamOfTrackerTeam({ organizationId, slug: ref.slug });
      return team === null ? null : { team };
    }
  }
}

async function suggested(
  scope: { organizationId: OrganizationId; refs: readonly OwnerRef[]; source: OwnerSource },
  control: ControlStore,
): Promise<SuggestedOwner[]> {
  const owners: SuggestedOwner[] = [];
  for (const ref of scope.refs) {
    const owner = await assigneeOf(scope.organizationId, ref, control);
    if (owner !== null) owners.push({ owner, source: scope.source });
  }
  return owners;
}

async function authorOf(organizationId: OrganizationId, suspect: SuspectCommit, control: ControlStore): Promise<Assignee | null> {
  const { login, email } = suspect.commit.author;
  const byLogin = login === null ? null : await control.memberOfTrackerAccount({ organizationId, login });
  if (byLogin !== null || email === null) return byLogin;
  return control.memberOfAddress({ organizationId, email });
}

// --- flow: the code host ---

async function locate(
  scope: { organizationId: OrganizationId; projectId: ProjectId; event: OwnedEventSummary },
  control: ControlStore,
): Promise<Located | null> {
  const frame = topInAppFrame(scope.event.ownership);
  if (frame === null) return null;
  const config = await control.ownershipConfig(scope.projectId);
  const placed = repositoryPathOf(config.codeMappings, frame.path);
  if (placed === null) return null;
  const connected = await control.isRepositoryConnected({ organizationId: scope.organizationId, repository: placed.mapping.repository });
  return connected ? { ...placed, line: frame.lineno } : null;
}

async function codeownersOf(located: Located, codeHost: CodeHost): Promise<readonly OwnerRef[]> {
  const { repository, ref } = located.mapping;
  for (const path of CODEOWNERS_PATHS) {
    const text = await codeHost.fileText({ repository, path, ref });
    if (!isRefusal(text)) return ownersByCodeowners(parseCodeowners(text), located.path);
  }
  return [];
}

async function suspectOf(
  located: Located,
  bound: { firstSeen: number; window: number },
  codeHost: CodeHost,
): Promise<SuspectCommit | null> {
  const { repository, ref } = located.mapping;
  const commit = await codeHost.blame({ repository, path: located.path, ref, line: located.line });
  if (isRefusal(commit) || !isWithinWindow(commit, bound)) return null;
  return { repository, path: located.path, line: located.line, commit };
}

// --- flow: the suggestion ---

async function ownersFound(
  scope: { organizationId: OrganizationId; projectId: ProjectId; event: OwnedEventSummary; firstSeen: number },
  deps: SuggestOwnersDeps,
): Promise<{ owners: readonly SuggestedOwner[]; suspectCommit: SuspectCommit | null }> {
  const { organizationId } = scope;
  const config = await deps.control.ownershipConfig(scope.projectId);
  const byRules = ownersByRules(parseOwnershipRules(config.ownershipRules).rules, scope.event.ownership);
  const owners = await suggested({ organizationId, refs: byRules, source: 'ownership_rule' }, deps.control);
  const located = await locate(scope, deps.control);
  if (located === null) return { owners: rankedOwners(owners), suspectCommit: null };
  const byCodeowners = await codeownersOf(located, deps.codeHost);
  owners.push(...(await suggested({ organizationId, refs: byCodeowners, source: 'codeowners' }, deps.control)));
  const suspectCommit = await suspectOf(located, { firstSeen: scope.firstSeen, window: deps.settings.suspectCommitWindow }, deps.codeHost);
  const author = suspectCommit === null ? null : await authorOf(organizationId, suspectCommit, deps.control);
  if (author !== null) owners.push({ owner: author, source: 'suspect_commit' });
  return { owners: rankedOwners(owners), suspectCommit };
}

async function autoAssign(
  scope: { projectId: ProjectId; issueId: IssueId; owners: readonly SuggestedOwner[] },
  deps: SuggestOwnersDeps,
): Promise<Assignee | null> {
  const { projectId, issueId } = scope;
  const config = await deps.control.ownershipConfig(projectId);
  const current = await deps.projects.assigneeOf(projectId, issueId);
  const assignee = autoAssignee(scope.owners, { autoAssign: config.autoAssign, current });
  if (assignee === null) return null;
  const changes = await deps.projects.assignIssue(projectId, issueId, assignee, 'system');
  return isRefusal(changes) ? null : assignee;
}

// --- exports ---

export async function suggestOwners(
  project: ProjectId,
  issue: IssueId,
  event: OwnedEventSummary,
  deps: SuggestOwnersDeps,
): Promise<OwnerSuggestion> {
  const none: OwnerSuggestion = { issueId: issue, owners: [], suspectCommit: null, assigned: null };
  const organizationId = await deps.control.organizationOf(project);
  const state = await deps.projects.getIssue(project, issue);
  if (organizationId === null || state === null) return none;
  const found = await ownersFound({ organizationId, projectId: project, event, firstSeen: state.firstSeen }, deps);
  const assigned = await autoAssign({ projectId: project, issueId: issue, owners: found.owners }, deps);
  return { ...none, ...found, assigned };
}
