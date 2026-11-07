// The reporter's entry points, called as functions with a Request and the
// root's in-memory fakes behind the use cases -- no Nuxt runtime. The
// widget's HTTP contract (widget/README.md) is the shape each answer is
// held to.
import { describe, expect, it } from 'vitest';
import {
  handleFileReport,
  handleListMyReports,
  handleReplyAsReporter,
  handleReportForm,
  handleViewFollowUp,
} from '../../server/handlers/reports.js';
import { ADA, assertionOf, EVE, filed, MIA, PROJECT, world, type World } from '../../../tests/unit/application/reports/world.js';

const HEADER = 'cf-access-jwt-assertion';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function entry(w: World, cookie = false) {
  return { ...w, assertions: { cookie } };
}

function reportRequest(fields: Record<string, string | Blob>, assertion: string | null = assertionOf(ADA)): Request {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  const headers: Record<string, string> = assertion === null ? {} : { [HEADER]: assertion };
  return new Request('https://console.example/api/report', { method: 'POST', body: form, headers });
}

function get(path: string, assertion: string | null): Request {
  return new Request(`https://console.example${path}`, { headers: assertion === null ? {} : { [HEADER]: assertion } });
}

function postJson(path: string, body: unknown, assertion: string): Request {
  return new Request(`https://console.example${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { [HEADER]: assertion, 'content-type': 'application/json' },
  });
}

describe('POST /api/report', () => {
  it("Report filed in Nightwatch's form: Given a reporter in a product using Nightwatch's report form, When they submit a message, Then they see a Report Reference at once", async () => {
    const w = world();
    const answer = await handleFileReport(reportRequest({ project: PROJECT, message: 'the save button does nothing' }), entry(w));
    expect(answer.status).toBe(201);
    const body = (await answer.json()) as { reference: string; status: string; followUpUrl: string };
    expect(body.status).toBe('received');
    expect(body.followUpUrl).toBe(`https://console.example/follow-up/${body.reference}`);
    expect(body.reference.length).toBeGreaterThan(0);
  });

  it('stores a png or jpeg screenshot with the Report and names the associated event', async () => {
    const w = world();
    const screenshot = new Blob([PNG], { type: 'image/png' });
    const answer = await handleFileReport(
      reportRequest({ project: PROJECT, message: 'broken', screenshot, associatedEventId: 'event-1' }),
      entry(w),
    );
    expect(answer.status).toBe(201);
    const [report] = await w.projects.reportsBy(PROJECT, { email: ADA });
    expect(report?.associatedEventId).toBe('event-1');
    expect(report?.attachments).toHaveLength(1);
  });

  it('refuses a screenshot that is not png or jpeg as invalid-screenshot, with 400', async () => {
    const answer = await handleFileReport(
      reportRequest({ project: PROJECT, message: 'broken', screenshot: new Blob(['<svg/>'], { type: 'image/svg+xml' }) }),
      entry(world()),
    );
    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({ refusal: 'invalid-screenshot' });
  });

  it('Unsigned report refused: Given a submission that carries no sign-in from a trusted issuer, When it is submitted, Then no Report is filed', async () => {
    for (const assertion of [null, 'assertion:mallory', 'assertion:forged']) {
      const w = world();
      const answer = await handleFileReport(reportRequest({ project: PROJECT, message: 'hello' }, assertion), entry(w));
      expect(answer.status).toBe(401);
      expect(await answer.json()).toEqual({ refusal: 'unsigned' });
      expect(await w.projects.reportsBy(PROJECT, { email: ADA })).toEqual([]);
    }
  });

  it('Empty message refused: Given a message that is empty, When the reporter submits, Then the Report is not filed and the form says why', async () => {
    const answer = await handleFileReport(reportRequest({ project: PROJECT, message: '   ' }), entry(world()));
    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({ refusal: 'empty-message' });
  });

  it('refuses a submission naming no Project, or an unknown one, with 400', async () => {
    const missing = await handleFileReport(reportRequest({ message: 'hello' }), entry(world()));
    const unknown = await handleFileReport(reportRequest({ project: 'project-unknown', message: 'hello' }), entry(world()));
    expect([missing.status, await missing.json()]).toEqual([400, { refusal: 'unknown-project' }]);
    expect([unknown.status, await unknown.json()]).toEqual([400, { refusal: 'unknown-project' }]);
  });

  it('Report quota: Given the Report Quota for a Project is exhausted, When a Report is submitted, Then it is refused with retry advice', async () => {
    const w = world({ quota: { [PROJECT]: { feedback: 0 } } });
    const answer = await handleFileReport(reportRequest({ project: PROJECT, message: 'hello' }), entry(w));
    expect(answer.status).toBe(429);
    expect(answer.headers.get('retry-after')).toBe('60');
    expect(await answer.json()).toEqual({ refusal: 'rate-limited' });
  });

  it('Failed send is visible (server side): a screenshot that cannot be stored files nothing and answers 503', async () => {
    const w = world();
    w.blobs.put = async () => ({ ok: false, retryable: true });
    const screenshot = new Blob([PNG], { type: 'image/png' });
    const answer = await handleFileReport(reportRequest({ project: PROJECT, message: 'hello', screenshot }), entry(w));
    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ refusal: 'unavailable' });
  });

  it('reads the CF_Authorization cookie only where the stage allows it', async () => {
    const request = () =>
      new Request('https://console.example/api/report', {
        method: 'POST',
        body: (() => {
          const form = new FormData();
          form.set('project', PROJECT);
          form.set('message', 'hello');
          return form;
        })(),
        headers: { cookie: `theme=dark; CF_Authorization=${assertionOf(ADA)}` },
      });
    expect((await handleFileReport(request(), entry(world(), false))).status).toBe(401);
    expect((await handleFileReport(request(), entry(world(), true))).status).toBe(201);
  });
});

describe('GET /api/report-form', () => {
  it('Reporter not asked who they are: Given a signed-in reporter, When the form opens, Then it asks for no name and no address', async () => {
    const answer = await handleReportForm(get(`/api/report-form?project=${PROJECT}`, assertionOf(ADA)), entry(world()));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ reporter: { email: ADA }, fields: ['message', 'screenshot', 'associatedEventId'] });
  });

  it('answers 401 with no sign-in and 404 for an unknown Project', async () => {
    expect((await handleReportForm(get(`/api/report-form?project=${PROJECT}`, null), entry(world()))).status).toBe(401);
    expect((await handleReportForm(get('/api/report-form?project=nope', assertionOf(ADA)), entry(world()))).status).toBe(404);
  });
});

describe('GET /api/follow-up/:reference', () => {
  it('Follow-up Page shows status: Given a Report Reference, When its reporter opens its Follow-up Page, Then they see the Report Status, the shared Thread and change dates, and nothing else about the issue', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    const answer = await handleViewFollowUp(get(`/api/follow-up/${receipt.reference}`, assertionOf(ADA)), receipt.reference, entry(w));
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as Record<string, unknown>;
    expect(Object.keys(body).toSorted()).toEqual(['changes', 'status', 'thread']);
    expect(body['status']).toBe('received');
  });

  it('Follow-up Page refuses others: Given a Report Reference, When a signed-in person who is neither its reporter nor a Member of its Project opens it, Then the page says it was not found', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    const answer = await handleViewFollowUp(get('/', assertionOf(EVE)), receipt.reference, entry(w));
    expect([answer.status, await answer.json()]).toEqual([404, { refusal: 'not-found' }]);
  });

  it('Unknown reference: Given a reference that does not exist or was revoked, When its Follow-up Page is opened, Then the page says it was not found and reveals nothing else', async () => {
    const answer = await handleViewFollowUp(get('/', assertionOf(ADA)), 'not-a-reference', entry(world()));
    expect([answer.status, await answer.json()]).toEqual([404, { refusal: 'not-found' }]);
  });

  it('answers 401 to a request with no Assertion', async () => {
    expect((await handleViewFollowUp(get('/', null), 'anything', entry(world()))).status).toBe(401);
  });
});

describe('POST /api/follow-up/:reference/reply', () => {
  it('Reporter reply reaches team: Given a Report Thread, When the reporter replies, Then the reply appears on the issue for the team', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    const answer = await handleReplyAsReporter(postJson('/', { text: 'still broken' }, assertionOf(ADA)), receipt.reference, entry(w));
    expect([answer.status, await answer.json()]).toEqual([201, { replied: true }]);
    const report = await w.projects.getReport(PROJECT, receipt.reportId);
    const comments = await w.projects.commentsOn(PROJECT, report?.issueId ?? '');
    expect(comments.map((comment) => comment.text)).toEqual(['still broken']);
  });

  it('refuses a blank or missing reply as empty-message, and anyone but the reporter as not found', async () => {
    const w = world();
    const receipt = await filed(w, ADA);
    const blank = await handleReplyAsReporter(postJson('/', { text: ' ' }, assertionOf(ADA)), receipt.reference, entry(w));
    const missing = await handleReplyAsReporter(postJson('/', {}, assertionOf(ADA)), receipt.reference, entry(w));
    const member = await handleReplyAsReporter(postJson('/', { text: 'hi' }, assertionOf(MIA)), receipt.reference, entry(w));
    expect([blank.status, missing.status, member.status]).toEqual([400, 400, 404]);
  });
});

describe('GET /api/my-reports', () => {
  it('My reports: Given a signed-in reporter, When they open their report list, Then they see all and only their own Reports in that Organization, each with its Report Reference', async () => {
    const w = world();
    await filed(w, ADA, 'first');
    await filed(w, EVE, 'not mine');
    const answer = await handleListMyReports(get('/api/my-reports', assertionOf(ADA)), entry(w));
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as { reports: { message: string; reference: string }[] };
    expect(body.reports.map((report) => report.message)).toEqual(['first']);
    expect(body.reports[0]?.reference.length).toBeGreaterThan(0);
  });

  it('answers 401 with no sign-in, or one no Organization trusts', async () => {
    expect((await handleListMyReports(get('/api/my-reports', null), entry(world()))).status).toBe(401);
    expect((await handleListMyReports(get('/api/my-reports', 'assertion:mallory'), entry(world()))).status).toBe(401);
  });
});
