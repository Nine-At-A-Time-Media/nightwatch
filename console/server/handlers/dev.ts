/**
 * The local stage's sign-in helper: `GET /dev/sign-in?email=&return=` asks
 * the development issuer for an Assertion for that address and the
 * console's local audience, sets it as the CF_Authorization cookie (which
 * only the local stage reads), and sends the browser back to `return`.
 * Every other stage has no issuer here and answers 404.
 */

import { ASSERTION_COOKIE, json } from './http.js';

/** The part of the issuer's service binding this helper uses. */
export type IssuerFetcher = { fetch(input: string): Promise<Response> };

export type DevSignInDeps = { readonly issuer: IssuerFetcher | null; readonly audience: string };

const DEFAULT_RETURN = '/my-reports';
/** Any host will do: the service binding routes by binding, not by name. */
const ISSUER_ORIGIN = 'http://local-issuer';

// --- predicates ---

/** Only a same-origin path, never `//host` or a scheme, so the helper redirects nowhere else. */
function isLocalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

// --- exports ---

export async function handleDevSignIn(request: Request, deps: DevSignInDeps): Promise<Response> {
  if (deps.issuer === null) return json(404, { refusal: 'not-found' });
  const params = new URL(request.url).searchParams;
  const email = params.get('email');
  if (!email) return json(400, { refusal: 'missing-email' });
  const asked = params.get('return') ?? DEFAULT_RETURN;
  const query = new URLSearchParams({ email, aud: deps.audience });
  const minted = await deps.issuer.fetch(`${ISSUER_ORIGIN}/dev/sign-in?${query.toString()}`);
  if (!minted.ok) return json(502, { refusal: 'issuer-refused' });
  const { assertion } = (await minted.json()) as { assertion: string };
  const cookie = `${ASSERTION_COOKIE}=${assertion}; Path=/; HttpOnly; SameSite=Lax`;
  return new Response(null, { status: 303, headers: { location: isLocalPath(asked) ? asked : DEFAULT_RETURN, 'set-cookie': cookie } });
}
