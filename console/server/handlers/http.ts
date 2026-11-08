/**
 * HTTP shapes shared by the console's entry points: where the Assertion is
 * read from, how a body is answered, and which status each Refusal reason
 * takes. Values in, values out; no port.
 *
 * Cloudflare Access puts the Assertion in the `Cf-Access-Jwt-Assertion`
 * header of every request it lets through. The local stage has no Access in
 * front of it, so there, and only there, the `CF_Authorization` cookie set
 * by the dev sign-in route is read as well.
 */

import type { Refusal } from '#nightwatch/domain/refusal.js';

export const ASSERTION_HEADER = 'cf-access-jwt-assertion';
export const ASSERTION_COOKIE = 'CF_Authorization';

/** Where an entry point may read the Assertion from; the cookie only on the local stage. */
export type AssertionSources = { readonly cookie: boolean };

/** The status each Refusal reason the console answers takes; any other reason is a 400. */
const STATUS_BY_REASON: Readonly<Record<string, number>> = {
  unsigned: 401,
  not_a_member: 403,
  'not-found': 404,
  issue_not_found: 404,
  'already-filed': 409,
  already_linked: 409,
  transition_not_allowed: 409,
  issue_deleting: 409,
  issue_merging: 409,
  'rate-limited': 429,
  tracker_not_found: 502,
  tracker_refused: 502,
  tracker_unreachable: 502,
  unavailable: 503,
  tracker_not_configured: 503,
};
const DEFAULT_REFUSAL_STATUS = 400;

// --- helpers ---

function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name && value.length > 0) return value.join('=');
  }
  return null;
}

// --- exports ---

/** The Assertion a request carries, or null when it carries none. */
export function assertionOf(request: Request, sources: AssertionSources): string | null {
  const header = request.headers.get(ASSERTION_HEADER);
  if (header) return header;
  return sources.cookie ? cookieValue(request.headers.get('cookie'), ASSERTION_COOKIE) : null;
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}

export function statusOf(refused: Refusal): number {
  return STATUS_BY_REASON[refused.refusal] ?? DEFAULT_REFUSAL_STATUS;
}

/** A Refusal as an answer: its reason and nothing else. */
export function refusedWith(refused: Refusal, headers: Record<string, string> = {}): Response {
  return json(statusOf(refused), { refusal: refused.refusal }, headers);
}

/** A JSON object body, or null when the body is not one. */
export async function jsonBodyOf(request: Request): Promise<Readonly<Record<string, unknown>> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
