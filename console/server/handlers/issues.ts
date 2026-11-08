/**
 * A Member's entry points: Issue search, one Issue, a comment on it, a
 * tracker issue opened from it, and the triage actions on it (triage,
 * merge, split, discard, assign). Each signs the Member in to the Project the
 * path names (signInMember), then calls one use case and shapes the answer.
 * Every use case below trusts the Member it is handed.
 */

import { searchIssues, type SearchIssuesDeps } from '#nightwatch/application/issues/search-issues.js';
import { viewIssue, type ViewIssueDeps } from '#nightwatch/application/issues/view-issue.js';
import { signInMember, type SignInMemberDeps } from '#nightwatch/application/signin/sign-in-member.js';
import { openExternalIssue, type OpenExternalIssueDeps } from '#nightwatch/application/tracker/open-external-issue.js';
import type { Assignee } from '#nightwatch/domain/alerts/issue-alert-rule.js';
import type { IssueChange, Member } from '#nightwatch/domain/issue/state.js';
import { parseTriageAction } from '#nightwatch/domain/issue/triage.js';
import { isRefusal, refusal, type Refusal } from '#nightwatch/domain/refusal.js';
import type { IssueFacts } from '#nightwatch/domain/search/match.js';
import type { IssuePage } from '#nightwatch/domain/search/page.js';
import { parseIssueQuery } from '#nightwatch/domain/search/parse.js';
import type { ProjectClient } from '#nightwatch/ports/project-client.js';
import type { Tracker } from '#nightwatch/ports/tracker.js';
import { assertionOf, json, jsonBodyOf, refusedWith } from './http.js';
import type { Entry } from './reports.js';

/** Which Project and Issue a path names. */
export type IssuePath = { readonly project: string; readonly issue: string };

/** openExternalIssue's deps with the Tracker the deployment may not have configured. */
export type OpenExternalIssueRouteDeps = Omit<OpenExternalIssueDeps, 'tracker'> & { tracker: Tracker | null };

const TRACKER_NOT_CONFIGURED = refusal('tracker_not_configured');
const INVALID_SOURCES = refusal('invalid_sources');
const INVALID_FINGERPRINTS = refusal('invalid_fingerprints');
const INVALID_ASSIGNEE = refusal('invalid_assignee');

/** What an Issue triage route takes: the Project's state and a Member's sign-in. */
type IssueRouteDeps = { projects: ProjectClient } & SignInMemberDeps & Entry;

// --- predicates ---

function isNonEmptyStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item !== '');
}

function isNamed(value: unknown, key: 'member' | 'team'): value is Record<typeof key, string> {
  if (typeof value !== 'object' || value === null || !(key in value)) return false;
  const name: unknown = (value as Record<string, unknown>)[key];
  return typeof name === 'string' && name !== '';
}

// --- helpers ---

/** One Issue of a page as the list shows it; Maps and the full state stay on the server. */
function listed(facts: IssueFacts) {
  const { state } = facts;
  return {
    issueId: state.issueId,
    projectId: facts.projectId,
    shortId: facts.shortId,
    title: facts.title,
    culprit: facts.culprit,
    level: facts.level,
    status: state.status,
    substatus: 'substatus' in state ? state.substatus : null,
    priority: state.priority.level,
    count: state.count,
    userCount: state.userCount,
    firstSeen: state.firstSeen,
    lastSeen: state.lastSeen,
    reportCount: facts.reportCount,
    linked: facts.linked,
  };
}

function pageBody(page: IssuePage) {
  return { issues: page.issues.map(listed), next: page.next };
}

/** The Assignee a body names: `"me"` is the signed-in Member, `null` unassigns. */
function assigneeOf(value: unknown, me: Member): Assignee | null | Refusal {
  if (value === null) return null;
  if (value === 'me') return me;
  if (isNamed(value, 'member')) return { member: value.member };
  if (isNamed(value, 'team')) return { team: value.team };
  return INVALID_ASSIGNEE;
}

function changesAnswer(changes: IssueChange[] | Refusal): Response {
  return isRefusal(changes) ? refusedWith(changes) : json(200, { changes });
}

// --- flow ---

async function memberOf(request: Request, project: string, deps: SignInMemberDeps & Entry): Promise<Member | Response> {
  const member = await signInMember(project, assertionOf(request, deps.assertions), deps);
  return isRefusal(member) ? refusedWith(member) : member;
}

// --- exports ---

/** GET /api/projects/:project/issues?query=&cursor= -- one page of the Member's Organization's Issues matching the query. */
export async function handleSearchIssues(
  request: Request,
  project: string,
  deps: SearchIssuesDeps & SignInMemberDeps & Entry,
): Promise<Response> {
  const member = await memberOf(request, project, deps);
  if (member instanceof Response) return member;
  const params = new URL(request.url).searchParams;
  const query = parseIssueQuery(params.get('query') ?? '');
  if (isRefusal(query)) return refusedWith(query);
  const page = await searchIssues(query, member, params.get('cursor') || null, deps);
  return isRefusal(page) ? refusedWith(page) : json(200, pageBody(page));
}

/** GET /api/projects/:project/issues/:issue -- the Issue with every Comment, shared or private. */
export async function handleViewIssue(
  request: Request,
  path: IssuePath,
  deps: ViewIssueDeps & SignInMemberDeps & Entry,
): Promise<Response> {
  const member = await memberOf(request, path.project, deps);
  if (member instanceof Response) return member;
  const view = await viewIssue(path.project, path.issue, deps);
  return isRefusal(view) ? refusedWith(view) : json(200, view);
}

/** POST /api/projects/:project/issues/:issue/comments with `{"text", "shared"}` -- 201 once the Comment is saved. */
export async function handleAddComment(
  request: Request,
  path: IssuePath,
  deps: { projects: ProjectClient } & SignInMemberDeps & Entry,
): Promise<Response> {
  const member = await memberOf(request, path.project, deps);
  if (member instanceof Response) return member;
  const body = await jsonBodyOf(request);
  const text = body?.['text'];
  if (typeof text !== 'string' || text.trim() === '') return refusedWith(refusal('empty-message'));
  const changes = await deps.projects.addComment(path.project, path.issue, { text, shared: body?.['shared'] === true }, member);
  return changes.length === 0 ? refusedWith(refusal('issue_not_found')) : json(201, { saved: true });
}

/** POST /api/projects/:project/issues/:issue/github with `{"repository"}` -- 201 with the External Link. */
export async function handleOpenExternalIssue(
  request: Request,
  path: IssuePath,
  deps: OpenExternalIssueRouteDeps & SignInMemberDeps & Entry,
): Promise<Response> {
  const member = await memberOf(request, path.project, deps);
  if (member instanceof Response) return member;
  const { tracker } = deps;
  if (tracker === null) return refusedWith(TRACKER_NOT_CONFIGURED);
  const repository = (await jsonBodyOf(request))?.['repository'];
  if (typeof repository !== 'string' || repository === '') return refusedWith(refusal('invalid-repository'));
  const linked = await openExternalIssue(path.project, path.issue, repository, member, { ...deps, tracker });
  return isRefusal(linked) ? refusedWith(linked) : json(201, linked);
}

/** POST /api/projects/:project/issues/:issue/triage with a triage action -- 200 `{changes}`. */
export async function handleTriageIssue(request: Request, path: IssuePath, deps: IssueRouteDeps): Promise<Response> {
  const member = await memberOf(request, path.project, deps);
  if (member instanceof Response) return member;
  const action = parseTriageAction(await jsonBodyOf(request));
  if (isRefusal(action)) return refusedWith(action);
  return changesAnswer(await deps.projects.triageIssue(path.project, path.issue, action, member));
}

/** POST /api/projects/:project/issues/:issue/merge with `{"sources"}` -- the sources merge into the Issue; 200 `{changes}`. */
export async function handleMergeIssues(request: Request, path: IssuePath, deps: IssueRouteDeps): Promise<Response> {
  const member = await memberOf(request, path.project, deps);
  if (member instanceof Response) return member;
  const sources = (await jsonBodyOf(request))?.['sources'];
  if (!isNonEmptyStringList(sources)) return refusedWith(INVALID_SOURCES);
  return changesAnswer(await deps.projects.mergeIssues(path.project, { target: path.issue, sources, actor: member }));
}

/** POST /api/projects/:project/issues/:issue/split with `{"fingerprints"}` -- they move to a new Issue; 200 `{changes}`. */
export async function handleSplitIssue(request: Request, path: IssuePath, deps: IssueRouteDeps): Promise<Response> {
  const member = await memberOf(request, path.project, deps);
  if (member instanceof Response) return member;
  const fingerprints = (await jsonBodyOf(request))?.['fingerprints'];
  if (!isNonEmptyStringList(fingerprints)) return refusedWith(INVALID_FINGERPRINTS);
  return changesAnswer(await deps.projects.splitIssue(path.project, { issueId: path.issue, fingerprints, actor: member }));
}

/** POST /api/projects/:project/issues/:issue/discard -- the Issue is removed and its Fingerprints tombstoned; 200 `{changes}`. */
export async function handleDiscardIssue(request: Request, path: IssuePath, deps: IssueRouteDeps): Promise<Response> {
  const member = await memberOf(request, path.project, deps);
  if (member instanceof Response) return member;
  return changesAnswer(await deps.projects.discardIssue(path.project, path.issue, member));
}

/** POST /api/projects/:project/issues/:issue/assign with `{"assignee"}` (`"me"`, `{member}`, `{team}` or null) -- 200 `{changes}`. */
export async function handleAssignIssue(request: Request, path: IssuePath, deps: IssueRouteDeps): Promise<Response> {
  const member = await memberOf(request, path.project, deps);
  if (member instanceof Response) return member;
  const body = await jsonBodyOf(request);
  if (body === null || !('assignee' in body)) return refusedWith(INVALID_ASSIGNEE);
  const assignee = assigneeOf(body['assignee'], member);
  if (assignee !== null && isRefusal(assignee)) return refusedWith(assignee);
  return changesAnswer(await deps.projects.assignIssue(path.project, path.issue, assignee, member));
}
