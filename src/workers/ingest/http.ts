/**
 * The ingest entry point's HTTP edges: which SDK route a path names, the
 * Arrival a request becomes, and the response an Admission becomes. Parsing
 * and shaping only; every ingest rule is admitArrival's.
 *
 * Routes: POST /api/<project>/envelope/, /store/ and /security/, and the HTTP
 * cron check-in /api/<project>/cron/<monitor>/[<key>/], whose optional last
 * segment is the Client Key. OPTIONS on any route answers a CORS preflight;
 * the POST that follows is still held to the Project's allowed origins. An
 * admitted check-in is also read as the Check-in the monitors Worker takes:
 * its monitor from the route, its status from the query, else the JSON body,
 * else ok.
 */

import type { Admission } from '../../domain/ingest/admission.js';
import type { Arrival, EndpointKind } from '../../domain/ingest/arrival.js';
import { rateLimitHeader, retryAfterSeconds } from '../../domain/protocol/retry-advice.js';

export type Route = { readonly projectId: string; readonly endpoint: EndpointKind; readonly pathKey: string | null };

/** A check-in as the monitors Worker takes it. */
export type ForwardedCheckIn = { readonly projectId: string; readonly monitorId: string; readonly status: 'in_progress' | 'ok' | 'error' };

/** Past the platform's own request cap, a decoded body is cut off here; the cut body fails its size or envelope checks. */
const DECODED_BODY_CEILING = 100 * 1024 * 1024;
const DECODABLE = new Set(['gzip', 'deflate']);
const ITEM_ROUTE = /^\/api\/([^/]+)\/(envelope|store|security)\/?$/;
const CHECKIN_ROUTE = /^\/api\/([^/]+)\/cron\/([^/]+)(?:\/([^/]+))?\/?$/;
const CHECKIN_STATUSES: ReadonlySet<string> = new Set<ForwardedCheckIn['status']>(['in_progress', 'ok', 'error']);
const DEFAULT_CHECKIN_STATUS = 'ok';
const ALLOWED_HEADERS = 'x-sentry-auth, authorization, content-type, content-encoding, sentry-trace, baggage';
const EXPOSED_HEADERS = 'x-sentry-rate-limits, retry-after';

// --- routes ---

export function routeOf(pathname: string): Route | null {
  const item = ITEM_ROUTE.exec(pathname);
  if (item?.[1] && item[2]) return { projectId: item[1], endpoint: item[2] as EndpointKind, pathKey: null };
  const checkin = CHECKIN_ROUTE.exec(pathname);
  if (checkin?.[1]) return { projectId: checkin[1], endpoint: 'checkin', pathKey: checkin[3] ?? null };
  return null;
}

// --- check-ins ---

function isCheckInStatus(status: unknown): status is ForwardedCheckIn['status'] {
  return typeof status === 'string' && CHECKIN_STATUSES.has(status);
}

function bodyStatus(body: Uint8Array): unknown {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    return typeof parsed === 'object' && parsed !== null && 'status' in parsed ? parsed.status : undefined;
  } catch {
    return undefined;
  }
}

/** The check-in a cron route carries, or null for another route or a status the monitors do not take. */
export function checkInOf({ url, body }: { url: URL; body: Uint8Array }): ForwardedCheckIn | null {
  const checkin = CHECKIN_ROUTE.exec(url.pathname);
  const [, projectId, monitorId] = checkin ?? [];
  if (projectId === undefined || monitorId === undefined) return null;
  const status = url.searchParams.get('status') ?? bodyStatus(body) ?? DEFAULT_CHECKIN_STATUS;
  return isCheckInStatus(status) ? { projectId, monitorId, status } : null;
}

// --- requests ---

function headerRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, name) => {
    record[name] = value;
  });
  return record;
}

function firstValues(params: URLSearchParams): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of params) if (!(key in values)) values[key] = value;
  return values;
}

export function arrivalOf({ route, url, headers, body }: { route: Route; url: URL; headers: Headers; body: Uint8Array }): Arrival {
  return {
    projectId: route.projectId,
    endpoint: route.endpoint,
    headers: headerRecord(headers),
    query: firstValues(url.searchParams),
    pathKey: route.pathKey,
    origin: headers.get('origin'),
    body,
  };
}

async function readCapped(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = stream.getReader();
  while (length <= DECODED_BODY_CEILING) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  await reader.cancel();
  const body = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.length;
  }
  return body;
}

/** The request body as sent, decoded when gzip or deflate; a body that fails to decode is kept raw, for admission to refuse. */
export async function readBody(request: Request): Promise<Uint8Array> {
  const raw = new Uint8Array(await request.arrayBuffer());
  const encoding = request.headers.get('content-encoding')?.trim().toLowerCase() ?? '';
  if (!DECODABLE.has(encoding)) return raw;
  try {
    return await readCapped(new Blob([raw]).stream().pipeThrough(new DecompressionStream(encoding as CompressionFormat)));
  } catch {
    return raw;
  }
}

// --- responses ---

function isOriginRefusal(admission: Admission): boolean {
  return admission.status === 403;
}

function detailOf(admission: Admission): string | null {
  return admission.outcomes.find((outcome) => outcome.kind !== 'accepted')?.reason ?? null;
}

function corsHeaders(origin: string): Record<string, string> {
  return { 'access-control-allow-origin': origin, 'access-control-expose-headers': EXPOSED_HEADERS, vary: 'Origin' };
}

export function admissionResponse({ admission, origin }: { admission: Admission; origin: string | null }): Response {
  const headers: Record<string, string> = {
    ...(origin !== null && !isOriginRefusal(admission) ? corsHeaders(origin) : {}),
    ...(admission.retryAdvice.length > 0
      ? { 'x-sentry-rate-limits': rateLimitHeader(admission.retryAdvice), 'retry-after': String(retryAfterSeconds(admission.retryAdvice)) }
      : {}),
  };
  const body = admission.decision === 'admitted' ? { id: admission.recordId } : { detail: detailOf(admission) };
  return Response.json(body, { status: admission.status, headers });
}

export function preflightResponse(origin: string | null): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin ?? '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': ALLOWED_HEADERS,
      'access-control-max-age': '86400',
      vary: 'Origin',
    },
  });
}
