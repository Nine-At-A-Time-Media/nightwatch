// A Member's entry points, called as functions with a Request and the
// root's in-memory fakes: the Code and GitHub world (one Organization, one
// Project, Mia a Member with a connected Repository and a FakeTracker).
import { describe, expect, it } from 'vitest';
import {
  handleAddComment,
  handleAssignIssue,
  handleDiscardIssue,
  handleMergeIssues,
  handleOpenExternalIssue,
  handleSearchIssues,
  handleSplitIssue,
  handleTriageIssue,
  handleViewIssue,
} from '../../server/handlers/issues.js';
import { assertionOf, EVE, MIA } from '../../../tests/unit/application/reports/world.js';
import { summary } from '../../../tests/unit/application/issues/world.js';
import { crashIssue, member, PROJECT, REPOSITORY, T0, world as trackerWorld } from '../../../tests/unit/application/tracker/world.js';

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

// --- task-038: triage, merge, split, discard, assign; Short Ids and Projects in search ---

type ChangesBody = { changes: { kind: string; to: string | null }[] };

describe('POST /api/projects/:project/issues/:issue/triage', () => {
  it('Resolve in next release: a Member resolves in the next release; the Issue is Resolved, pending that release', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    const path = { project: PROJECT, issue: issueId };
    const answer = await handleTriageIssue(postJson({ kind: 'resolve', resolution: { kind: 'in_next_release' } }), path, entry(w));
    expect(answer.status).toBe(200);
    expect(((await answer.json()) as ChangesBody).changes.map((change) => change.kind)).toEqual(['status', 'resolution', 'for_review']);
    expect(await w.projects.getIssue(PROJECT, issueId)).toMatchObject({
      status: 'resolved',
      resolution: { kind: 'in_next_release', release: null },
    });
  });

  it('archives, unarchives and sets a Priority by hand', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    const path = { project: PROJECT, issue: issueId };
    await handleTriageIssue(postJson({ kind: 'archive', archive: { substatus: 'until_escalating' } }), path, entry(w));
    expect(await w.projects.getIssue(PROJECT, issueId)).toMatchObject({ status: 'archived', substatus: 'until_escalating' });
    await handleTriageIssue(postJson({ kind: 'unarchive' }), path, entry(w));
    await handleTriageIssue(postJson({ kind: 'set_priority', level: 'low' }), path, entry(w));
    expect(await w.projects.getIssue(PROJECT, issueId)).toMatchObject({
      status: 'unresolved',
      priority: { level: 'low', setByHand: true },
    });
  });

  it('refuses an illegal transition with 409, a malformed action with 400, an unknown Issue with 404 and a non-member with 403', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    const path = { project: PROJECT, issue: issueId };
    const illegal = await handleTriageIssue(postJson({ kind: 'unresolve' }), path, entry(w));
    expect([illegal.status, await illegal.json()]).toEqual([409, { refusal: 'transition_not_allowed' }]);
    expect((await handleTriageIssue(postJson({ kind: 'explode' }), path, entry(w))).status).toBe(400);
    expect((await handleTriageIssue(postJson({ kind: 'unresolve' }), { project: PROJECT, issue: 'nope' }, entry(w))).status).toBe(404);
    expect((await handleTriageIssue(postJson({ kind: 'unresolve' }, assertionOf(EVE)), path, entry(w))).status).toBe(403);
  });
});

describe('POST /api/projects/:project/issues/:issue/merge, /split, /discard', () => {
  it('Merge: a Member merges source Issues into the Issue the path names', async () => {
    const w = world();
    const target = await crashIssue(w);
    const source = await crashIssue(w);
    const answer = await handleMergeIssues(postJson({ sources: [source] }), { project: PROJECT, issue: target }, entry(w));
    expect(answer.status).toBe(200);
    expect(await w.projects.getIssue(PROJECT, source)).toBeNull();
    expect((await w.projects.getIssue(PROJECT, target))?.count).toBe(2);
    expect((await handleMergeIssues(postJson({ sources: [] }), { project: PROJECT, issue: target }, entry(w))).status).toBe(400);
  });

  it('Split: a Member splits a Fingerprint off into a new Issue', async () => {
    const w = world();
    const assignment = await w.projects.assignEvent(PROJECT, summary(T0), ['fp-left', 'fp-right']);
    const issueId = 'issueId' in assignment ? assignment.issueId : '';
    const path = { project: PROJECT, issue: issueId };
    const answer = await handleSplitIssue(postJson({ fingerprints: ['fp-right'] }), path, entry(w));
    expect(answer.status).toBe(200);
    expect(await w.projects.fingerprintsOf(PROJECT, issueId)).toEqual(['fp-left']);
    expect((await handleSplitIssue(postJson({ fingerprints: 'fp-left' }), path, entry(w))).status).toBe(400);
  });

  it('Discard: a Member discards the Issue; it is gone', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    const answer = await handleDiscardIssue(postJson({}), { project: PROJECT, issue: issueId }, entry(w));
    expect(answer.status).toBe(200);
    expect(await w.projects.getIssue(PROJECT, issueId)).toBeNull();
    expect((await handleDiscardIssue(postJson({}), { project: PROJECT, issue: issueId }, entry(w))).status).toBe(404);
  });
});

describe('POST /api/projects/:project/issues/:issue/assign', () => {
  it('assigns the Issue to the signed-in Member with "me", to a Team, and unassigns it with null', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    const path = { project: PROJECT, issue: issueId };
    expect((await handleAssignIssue(postJson({ assignee: 'me' }), path, entry(w))).status).toBe(200);
    expect(await w.projects.assigneeOf(PROJECT, issueId)).toEqual(member);
    await handleAssignIssue(postJson({ assignee: { team: 'web' } }), path, entry(w));
    expect(await w.projects.assigneeOf(PROJECT, issueId)).toEqual({ team: 'web' });
    await handleAssignIssue(postJson({ assignee: null }), path, entry(w));
    expect(await w.projects.assigneeOf(PROJECT, issueId)).toBeNull();
    expect((await handleAssignIssue(postJson({ assignee: 42 }), path, entry(w))).status).toBe(400);
  });
});

describe('Short Ids and Projects in the console', () => {
  it("search results name each Issue's own Project and a Short Id with its slug; the Issue page shows the Short Id", async () => {
    const w = world();
    const issueId = await crashIssue(w);
    const answer = await handleSearchIssues(get(`/api/projects/${PROJECT}/issues?query=is:unresolved`), PROJECT, entry(w));
    const body = (await answer.json()) as { issues: { issueId: string; projectId: string; shortId: string }[] };
    expect(body.issues).toEqual([expect.objectContaining({ issueId, projectId: PROJECT, shortId: expect.stringMatching(/^WEB-/) })]);
    const view = (await (await handleViewIssue(get('/'), { project: PROJECT, issue: issueId }, entry(w))).json()) as { shortId: string };
    expect(view.shortId).toBe(body.issues[0]?.shortId);
  });
});
