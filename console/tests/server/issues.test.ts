// A Member's entry points, called as functions with a Request and the
// root's in-memory fakes: the Code and GitHub world (one Organization, one
// Project, Mia a Member with a connected Repository and a FakeTracker).
import { describe, expect, it } from 'vitest';
import { handleAddComment, handleOpenExternalIssue, handleSearchIssues, handleViewIssue } from '../../server/handlers/issues.js';
import { assertionOf, EVE, MIA } from '../../../tests/unit/application/reports/world.js';
import { crashIssue, member, PROJECT, REPOSITORY, world as trackerWorld } from '../../../tests/unit/application/tracker/world.js';

const HEADER = 'cf-access-jwt-assertion';

function world() {
  const w = trackerWorld();
  w.control.addMember(PROJECT, member, { email: MIA });
  return w;
}

type World = ReturnType<typeof world>;

function entry(w: World) {
  return { ...w, settings: w.trackerSettings, assertions: { cookie: false } };
}

function get(path: string, assertion: string | null = assertionOf(MIA)): Request {
  return new Request(`https://console.example${path}`, { headers: assertion === null ? {} : { [HEADER]: assertion } });
}

function postJson(body: unknown, assertion = assertionOf(MIA)): Request {
  return new Request('https://console.example/', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { [HEADER]: assertion, 'content-type': 'application/json' },
  });
}

describe('GET /api/projects/:project/issues', () => {
  it("Search: Given issues, When a Member searches, Then the page lists the matching Issues of the Member's Organization", async () => {
    const w = world();
    const issueId = await crashIssue(w, { title: 'TypeError: x is undefined' });
    const answer = await handleSearchIssues(get(`/api/projects/${PROJECT}/issues?query=is:unresolved`), PROJECT, entry(w));
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as { issues: { issueId: string; title: string; status: string }[]; next: string | null };
    expect(body.issues.map((issue) => [issue.issueId, issue.title, issue.status])).toEqual([
      [issueId, 'TypeError: x is undefined', 'unresolved'],
    ]);
    expect(body.next).toBeNull();
  });

  it('refuses a query that does not parse with 400, and anyone not a Member of the Project with 401 or 403', async () => {
    const w = world();
    const bad = await handleSearchIssues(get(`/api/projects/${PROJECT}/issues?query=is:nonsense`), PROJECT, entry(w));
    expect(bad.status).toBe(400);
    expect((await handleSearchIssues(get('/', null), PROJECT, entry(w))).status).toBe(401);
    expect((await handleSearchIssues(get('/', assertionOf(EVE)), PROJECT, entry(w))).status).toBe(403);
    expect((await handleSearchIssues(get('/'), 'project-unknown', entry(w))).status).toBe(404);
  });
});

describe('GET /api/projects/:project/issues/:issue', () => {
  it('shows a Member the Issue and every Comment on it, shared or private', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    await w.projects.addComment(PROJECT, issueId, { text: 'private note', shared: false }, member);
    const answer = await handleViewIssue(get('/'), { project: PROJECT, issue: issueId }, entry(w));
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as { state: { issueId: string }; comments: { text: string; shared: boolean }[] };
    expect(body.state.issueId).toBe(issueId);
    expect(body.comments.map((comment) => [comment.text, comment.shared])).toEqual([['private note', false]]);
  });

  it('answers 404 for an Issue the Project does not hold, and 403 to a non-member', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    expect((await handleViewIssue(get('/'), { project: PROJECT, issue: 'nope' }, entry(w))).status).toBe(404);
    expect((await handleViewIssue(get('/', assertionOf(EVE)), { project: PROJECT, issue: issueId }, entry(w))).status).toBe(403);
  });
});

describe('POST /api/projects/:project/issues/:issue/comments', () => {
  it('Shared reply reaches reporter: Given a team member comments and marks it shared, When the comment is saved, Then it is saved shared on the Issue', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    const answer = await handleAddComment(postJson({ text: 'fixed soon', shared: true }), { project: PROJECT, issue: issueId }, entry(w));
    expect([answer.status, await answer.json()]).toEqual([201, { saved: true }]);
    const comments = await w.projects.commentsOn(PROJECT, issueId);
    expect(comments).toEqual([expect.objectContaining({ text: 'fixed soon', shared: true, author: member })]);
  });

  it('Private comment stays private: Given a team member comments without marking it shared, When the comment is saved, Then it is saved private', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    await handleAddComment(postJson({ text: 'cache bug?' }), { project: PROJECT, issue: issueId }, entry(w));
    expect(await w.projects.commentsOn(PROJECT, issueId)).toEqual([expect.objectContaining({ text: 'cache bug?', shared: false })]);
  });

  it('refuses a blank comment with 400, an unknown Issue with 404, and a non-member with 403', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    expect((await handleAddComment(postJson({ text: '' }), { project: PROJECT, issue: issueId }, entry(w))).status).toBe(400);
    expect((await handleAddComment(postJson({ text: 'hi' }), { project: PROJECT, issue: 'nope' }, entry(w))).status).toBe(404);
    const outsider = await handleAddComment(postJson({ text: 'hi' }, assertionOf(EVE)), { project: PROJECT, issue: issueId }, entry(w));
    expect(outsider.status).toBe(403);
  });
});

describe('POST /api/projects/:project/issues/:issue/github', () => {
  it('Open GitHub issue: Given an Issue, When a Member opens a GitHub issue from it, Then the External Link is answered', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    const answer = await handleOpenExternalIssue(postJson({ repository: REPOSITORY }), { project: PROJECT, issue: issueId }, entry(w));
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ issueId, repository: REPOSITORY, state: 'linked' });
  });

  it('answers 503 when no tracker is configured, and 400 with no repository', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    const path = { project: PROJECT, issue: issueId };
    const unconfigured = await handleOpenExternalIssue(postJson({ repository: REPOSITORY }), path, { ...entry(w), tracker: null });
    expect([unconfigured.status, await unconfigured.json()]).toEqual([503, { refusal: 'tracker_not_configured' }]);
    expect((await handleOpenExternalIssue(postJson({}), path, entry(w))).status).toBe(400);
  });
});
