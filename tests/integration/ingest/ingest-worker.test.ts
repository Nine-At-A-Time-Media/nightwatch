// The ingest Worker end to end in workerd: a real SDK request against SELF,
// with the Project's config seeded in KV, ends as an Arrival Record in the
// LogDO arrival log, or as the refusal its Admission names.
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { LogArrivalStream } from '../../../src/adapters/logdo/log-arrival-stream.js';
import type { ArrivalRecord } from '../../../src/domain/ingest/arrival.js';
import { serializeEnvelope } from '../../../src/domain/protocol/envelope.js';
import { FakeClock } from '../../_fakes/fake-clock.js';

const ORIGIN = 'https://app.example.com';
const enc = (text: string) => new TextEncoder().encode(text);

const eventEnvelope = new Uint8Array(
  serializeEnvelope({
    header: { event_id: '9ec79c33ec9942ab8353589fcb2e04dc' },
    items: [{ header: { type: 'event' }, payload: enc(JSON.stringify({ exception: { values: [{ type: 'Error', value: 'boom' }] } })) }],
  }),
);

let project: string;

async function seedProject(quotas?: object): Promise<void> {
  const config = {
    clientKeys: [
      { publicKey: 'k-live', active: true },
      { publicKey: 'k-off', active: false },
    ],
    allowedOrigins: [ORIGIN],
    sizeLimits: { event: 100_000, attachment: 1_000_000, arrival: 2_000_000 },
    inboundFilters: { browserExtensions: false, localhost: false, webCrawlers: false, releases: [], messages: [], addresses: [] },
    ...(quotas ? { quotas } : {}),
  };
  await env.PROJECT_CONFIG.put(project, JSON.stringify(config));
}

function post(path: string, init: { body: BodyInit; headers?: Record<string, string> }): Promise<Response> {
  return SELF.fetch(`https://ingest.example${path}`, { method: 'POST', ...init });
}

async function retainedRecord(id: string): Promise<ArrivalRecord | undefined> {
  const log = new LogArrivalStream({ log: env.LOG.getByName('arrivals'), clock: new FakeClock(0), leaseMs: 1 });
  const subscription = `test-${crypto.randomUUID()}`;
  await log.subscribe({ subscription, start: 'earliest' });
  const leased = await log.pull({ subscription, workerId: 'test', max: 1000 });
  return leased.map((l) => l.record).find((record) => record.id === id);
}

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

beforeEach(async () => {
  project = String(Math.floor(Math.random() * 1e9));
  await seedProject();
});

describe('ingest Worker', () => {
  it('an envelope with its key in the query string is acknowledged 200 and retained in the arrival log as sent', async () => {
    const response = await post(`/api/${project}/envelope/?sentry_key=k-live&sentry_version=7`, { body: eventEnvelope });
    expect(response.status).toBe(200);
    const { id } = await response.json<{ id: string }>();
    const record = await retainedRecord(id);
    expect(record).toMatchObject({ id, projectId: project, endpoint: 'envelope', blobKey: null });
    expect(record?.body).toEqual(eventEnvelope);
  });

  it('a gzip-encoded envelope is retained decoded', async () => {
    const response = await post(`/api/${project}/envelope/`, {
      body: await gzip(eventEnvelope),
      headers: { 'content-encoding': 'gzip', 'x-sentry-auth': 'Sentry sentry_key=k-live, sentry_version=7' },
    });
    expect(response.status).toBe(200);
    const { id } = await response.json<{ id: string }>();
    expect((await retainedRecord(id))?.body).toEqual(eventEnvelope);
  });

  it('a legacy store request with its key in the auth header is acknowledged', async () => {
    const response = await post(`/api/${project}/store/`, {
      body: JSON.stringify({ message: 'hello' }),
      headers: { 'x-sentry-auth': 'Sentry sentry_key=k-live, sentry_version=7' },
    });
    expect(response.status).toBe(200);
  });

  it('a cron check-in with its key in the path is acknowledged and forwarded to the monitors Worker', async () => {
    const response = await post(`/api/${project}/cron/nightly/k-live/`, { body: JSON.stringify({ status: 'ok' }) });
    expect(response.status).toBe(200);
    expect(JSON.parse((await env.PROJECT_CONFIG.get(`forwarded-check-in:${project}`)) ?? 'null')).toEqual({
      projectId: project,
      monitorId: 'nightly',
      status: 'ok',
    });
  });

  it('a refused check-in is not forwarded', async () => {
    const response = await post(`/api/${project}/cron/nightly/k-off/`, { body: JSON.stringify({ status: 'ok' }) });
    expect(response.status).toBe(401);
    expect(await env.PROJECT_CONFIG.get(`forwarded-check-in:${project}`)).toBeNull();
  });

  it('a disabled key is refused 401 and nothing is acknowledged', async () => {
    const response = await post(`/api/${project}/envelope/?sentry_key=k-off`, { body: eventEnvelope });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ detail: 'disabled-key' });
  });

  it('a browser post from an origin the Project does not allow is refused 403', async () => {
    const response = await post(`/api/${project}/envelope/?sentry_key=k-live`, {
      body: eventEnvelope,
      headers: { origin: 'https://evil.example' },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('a browser post from an allowed origin is readable by that origin', async () => {
    const response = await post(`/api/${project}/envelope/?sentry_key=k-live`, { body: eventEnvelope, headers: { origin: ORIGIN } });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('an exhausted Quota is refused 429 with Retry Advice in the SDK rate-limit header and Retry-After', async () => {
    await seedProject({ windowSeconds: 3600, limits: { error: 0 } });
    const response = await post(`/api/${project}/envelope/?sentry_key=k-live`, { body: eventEnvelope });
    expect(response.status).toBe(429);
    expect(response.headers.get('x-sentry-rate-limits')).toMatch(/^\d+:error:project:quota-exceeded$/);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('a CORS preflight is answered for POST', async () => {
    const response = await SELF.fetch(`https://ingest.example/api/${project}/envelope/`, {
      method: 'OPTIONS',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
  });

  it('a path that names no SDK route is 404, and a GET on a route is 405', async () => {
    expect((await SELF.fetch(`https://ingest.example/api/${project}/nothing/`)).status).toBe(404);
    expect((await SELF.fetch(`https://ingest.example/api/${project}/envelope/`)).status).toBe(405);
  });
});
