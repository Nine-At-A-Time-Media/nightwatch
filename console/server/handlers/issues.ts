/**
 * A Member's entry points: Issue search, one Issue, a comment on it, and a
 * tracker issue opened from it. Each signs the Member in to the Project the
 * path names (signInMember), then calls one use case and shapes the answer.
 * Every use case below trusts the Member it is handed.
 */

import { searchIssues, type SearchIssuesDeps } from '#nightwatch/application/issues/search-issues.js';
import { viewIssue, type ViewIssueDeps } from '#nightwatch/application/issues/view-issue.js';
import { signInMember, type SignInMemberDeps } from '#nightwatch/application/signin/sign-in-member.js';
import { openExternalIssue, type OpenExternalIssueDeps } from '#nightwatch/application/tracker/open-external-issue.js';
import type { Member } from '#nightwatch/domain/issue/state.js';
import { isRefusal, refusal } from '#nightwatch/domain/refusal.js';
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

// --- helpers ---

/** One Issue of a page as the list shows it; Maps and the full state stay on the server. */
function listed(facts: IssueFacts) {
  const { state } = facts;
  return {
    issueId: state.issueId,
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
