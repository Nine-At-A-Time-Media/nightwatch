/**
 * The local issuer's routes, as a plain function over a LocalIssuer (dev
 * only; architecture Sign-in and Local development):
 *
 * - `GET /cdn-cgi/access/certs` -- the public keys, where Access publishes a
 *   team domain's keys, so the console's AccessSignInVerifier reads them as
 *   it reads a real issuer's.
 * - `GET /dev/sign-in?email=&aud=` -- mints an Assertion for that address
 *   and audience, as `{"assertion"}`, valid for SIGN_IN_TTL_SECONDS.
 */

import type { LocalIssuer } from './local-issuer.js';

const CERTS_PATH = '/cdn-cgi/access/certs';
const SIGN_IN_PATH = '/dev/sign-in';
/** How long a minted Assertion stays valid: one working day. */
const SIGN_IN_TTL_SECONDS = 8 * 60 * 60;

// --- helpers ---

function refused(status: number, refusal: string): Response {
  return Response.json({ refusal }, { status });
}

// --- flow ---

async function signIn(url: URL, options: { issuer: LocalIssuer; now: Date }): Promise<Response> {
  const email = url.searchParams.get('email');
  const aud = url.searchParams.get('aud');
  if (!email) return refused(400, 'missing-email');
  if (!aud) return refused(400, 'missing-audience');
  const assertion = await options.issuer.mint({ email, aud, ttlSeconds: SIGN_IN_TTL_SECONDS, issuedAt: options.now });
  return Response.json({ assertion });
}

// --- exports ---

export async function issuerAnswer(request: Request, options: { issuer: LocalIssuer; now: Date }): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET') return refused(405, 'method-not-allowed');
  if (url.pathname === CERTS_PATH) return Response.json(options.issuer.jwks);
  if (url.pathname === SIGN_IN_PATH) return signIn(url, options);
  return refused(404, 'not-found');
}
