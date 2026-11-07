// The ingest entry point's parsing and shaping: which SDK route a path names,
// the Arrival a request becomes, and the HTTP answer an Admission becomes.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Admission } from '../../../../src/domain/ingest/admission.js';
import { admissionResponse, arrivalOf, preflightResponse, routeOf } from '../../../../src/workers/ingest/http.js';

const segment = fc.stringMatching(/^[A-Za-z0-9_-]{1,16}$/);

describe('routeOf', () => {
  it.each([
    ['/api/42/envelope/', { projectId: '42', endpoint: 'envelope', pathKey: null }],
    ['/api/42/envelope', { projectId: '42', endpoint: 'envelope', pathKey: null }],
    ['/api/42/store/', { projectId: '42', endpoint: 'store', pathKey: null }],
    ['/api/42/security/', { projectId: '42', endpoint: 'security', pathKey: null }],
    ['/api/42/cron/nightly/k1/', { projectId: '42', endpoint: 'checkin', pathKey: 'k1' }],
    ['/api/42/cron/nightly/', { projectId: '42', endpoint: 'checkin', pathKey: null }],
  ])('names the SDK route of %s', (path, route) => {
    expect(routeOf(path)).toEqual(route);
  });

  it.each(['/', '/api/42/', '/api/42/events/', '/api//envelope/', '/x/api/42/envelope/', '/api/42/envelope/extra/'])(
    'names no route for %s',
    (path) => {
      expect(routeOf(path)).toBeNull();
    },
  );

  it('round-trips any project id and route kind through the path', () => {
    fc.assert(
      fc.property(segment, fc.constantFrom('envelope', 'store', 'security'), (projectId, endpoint) => {
        expect(routeOf(`/api/${projectId}/${endpoint}/`)).toEqual({ projectId, endpoint, pathKey: null });
      }),
    );
  });
});

describe('arrivalOf', () => {
  it('carries lowercased headers, the query, the path key, the Origin and the body', () => {
    const body = new Uint8Array([1, 2, 3]);
    const headers = new Headers({ 'X-Sentry-Auth': 'Sentry sentry_key=k1', Origin: 'https://app.example.com' });
    const url = new URL('https://ingest.example/api/42/cron/nightly/k1/?status=ok&status=late');
    expect(arrivalOf({ route: { projectId: '42', endpoint: 'checkin', pathKey: 'k1' }, url, headers, body })).toEqual({
      projectId: '42',
      endpoint: 'checkin',
      headers: { 'x-sentry-auth': 'Sentry sentry_key=k1', origin: 'https://app.example.com' },
      query: { status: 'ok' },
      pathKey: 'k1',
      origin: 'https://app.example.com',
      body,
    });
  });

  it('reads a request without an Origin as a server SDK', () => {
    const arrival = arrivalOf({
      route: { projectId: '42', endpoint: 'envelope', pathKey: null },
      url: new URL('https://ingest.example/api/42/envelope/'),
      headers: new Headers(),
      body: new Uint8Array(),
    });
    expect(arrival.origin).toBeNull();
  });
});

describe('admissionResponse', () => {
  const advice = [{ retryAfterSeconds: 60, categories: ['error' as const], scope: 'project' as const, reason: 'quota-exceeded' }];

  it('answers an admitted Arrival 200 with its record id, readable from the sending origin', async () => {
    const admission: Admission = { decision: 'admitted', status: 200, recordId: 'r1', outcomes: [], retryAdvice: [] };
    const response = admissionResponse({ admission, origin: 'https://app.example.com' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'r1' });
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(response.headers.get('x-sentry-rate-limits')).toBeNull();
  });

  it('answers a rate-limited Arrival with its status, Retry Advice header and Retry-After', async () => {
    const outcome = {
      projectId: '42',
      recordedAt: 1,
      kind: 'rate_limited' as const,
      reason: 'quota-exceeded',
      category: 'error' as const,
      quantity: 1,
    };
    const admission: Admission = { decision: 'refused', status: 429, outcomes: [outcome], retryAdvice: advice };
    const response = admissionResponse({ admission, origin: null });
    expect(response.status).toBe(429);
    expect(response.headers.get('x-sentry-rate-limits')).toBe('60:error:project:quota-exceeded');
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await response.json()).toEqual({ detail: 'quota-exceeded' });
  });

  it('does not open a refused origin to the browser', () => {
    const outcome = {
      projectId: '42',
      recordedAt: 1,
      kind: 'invalid' as const,
      reason: 'origin-not-allowed',
      category: 'default' as const,
      quantity: 1,
    };
    const admission: Admission = { decision: 'refused', status: 403, outcomes: [outcome], retryAdvice: [] };
    expect(admissionResponse({ admission, origin: 'https://evil.example' }).headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('preflightResponse', () => {
  it('allows POST from the asking origin, with the SDK headers', () => {
    const response = preflightResponse('https://app.example.com');
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toContain('x-sentry-auth');
  });
});
