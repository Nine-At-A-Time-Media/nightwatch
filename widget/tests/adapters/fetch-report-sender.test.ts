import { describe, expect, it } from 'vitest';
import { FetchReportSender, type FetchFunction } from '../../src/adapters/fetch-report-sender.js';
import { refusal } from '../../src/domain/refusal.js';
import type { ReportSubmission } from '../../src/domain/report-form.js';

type Call = { readonly input: string; readonly init: RequestInit };

const ENDPOINT = '/nightwatch/report';
const receipt = { reference: 'ref-1', status: 'received', followUpUrl: 'https://console.example.com/follow-up/ref-1' };
const submission: ReportSubmission = { project: 'p1', message: 'it broke', screenshot: null, associatedEventId: null };

function fakeFetch(answer: () => Promise<Response>): { readonly fetch: FetchFunction; readonly calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: (input, init) => {
      calls.push({ input, init });
      return answer();
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function sentForm(calls: readonly Call[]): FormData {
  const body = calls[0]?.init.body;
  if (!(body instanceof FormData)) throw new Error('expected a multipart form body');
  return body;
}

describe('FetchReportSender contract', () => {
  it('posts the Report Submission as multipart form fields to the endpoint, same-origin', async () => {
    const fake = fakeFetch(async () => jsonResponse(201, receipt));
    const screenshot = new File(['png'], 'shot.png', { type: 'image/png' });
    await new FetchReportSender(fake.fetch).send(ENDPOINT, { ...submission, screenshot, associatedEventId: 'evt-1' });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.input).toBe(ENDPOINT);
    expect(fake.calls[0]?.init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    const form = sentForm(fake.calls);
    expect(form.get('project')).toBe('p1');
    expect(form.get('message')).toBe('it broke');
    expect(form.get('associatedEventId')).toBe('evt-1');
    const file = form.get('screenshot');
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).type).toBe('image/png');
  });

  it('sends no screenshot or associatedEventId field when the submission has none', async () => {
    const fake = fakeFetch(async () => jsonResponse(201, receipt));
    await new FetchReportSender(fake.fetch).send(ENDPOINT, submission);
    const form = sentForm(fake.calls);
    expect(form.has('screenshot')).toBe(false);
    expect(form.has('associatedEventId')).toBe(false);
    expect([...form.keys()].sort()).toEqual(['message', 'project']);
  });

  it('returns the Filing Receipt from a 201', async () => {
    const fake = fakeFetch(async () => jsonResponse(201, receipt));
    expect(await new FetchReportSender(fake.fetch).send(ENDPOINT, submission)).toEqual(receipt);
  });

  it('accepts a same-origin path as the Follow-up Page link', async () => {
    const relative = { ...receipt, followUpUrl: '/follow-up/ref-1' };
    const fake = fakeFetch(async () => jsonResponse(201, relative));
    expect(await new FetchReportSender(fake.fetch).send(ENDPOINT, submission)).toEqual(relative);
  });

  it('refuses a receipt whose link is not http(s) or a path, so no script link is ever shown', async () => {
    for (const followUpUrl of ['javascript:alert(1)', '//evil.example.com/x', 'data:text/html,x']) {
      const fake = fakeFetch(async () => jsonResponse(201, { ...receipt, followUpUrl }));
      expect(await new FetchReportSender(fake.fetch).send(ENDPOINT, submission)).toEqual(refusal('unreadable-receipt'));
    }
  });

  it('refuses a 2xx whose body is not a Filing Receipt', async () => {
    const fake = fakeFetch(async () => new Response('ok', { status: 201 }));
    expect(await new FetchReportSender(fake.fetch).send(ENDPOINT, submission)).toEqual(refusal('unreadable-receipt'));
  });

  it('passes on the reason of a 400 refusal', async () => {
    const fake = fakeFetch(async () => jsonResponse(400, { refusal: 'message-too-long' }));
    expect(await new FetchReportSender(fake.fetch).send(ENDPOINT, submission)).toEqual(refusal('message-too-long'));
  });

  it('refuses a 400 with no readable reason as invalid-submission', async () => {
    const fake = fakeFetch(async () => new Response('bad', { status: 400 }));
    expect(await new FetchReportSender(fake.fetch).send(ENDPOINT, submission)).toEqual(refusal('invalid-submission'));
  });

  it('maps 401 and 403 to not-signed-in', async () => {
    for (const status of [401, 403]) {
      const fake = fakeFetch(async () => new Response(null, { status }));
      expect(await new FetchReportSender(fake.fetch).send(ENDPOINT, submission)).toEqual(refusal('not-signed-in'));
    }
  });

  it('maps 429 to too-many-reports', async () => {
    const fake = fakeFetch(async () => new Response(null, { status: 429 }));
    expect(await new FetchReportSender(fake.fetch).send(ENDPOINT, submission)).toEqual(refusal('too-many-reports'));
  });

  it('maps a 5xx to not-sent', async () => {
    for (const status of [500, 502, 503]) {
      const fake = fakeFetch(async () => new Response(null, { status }));
      expect(await new FetchReportSender(fake.fetch).send(ENDPOINT, submission)).toEqual(refusal('not-sent'));
    }
  });

  it('maps a network failure to not-sent', async () => {
    const fake = fakeFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await new FetchReportSender(fake.fetch).send(ENDPOINT, submission)).toEqual(refusal('not-sent'));
  });
});
