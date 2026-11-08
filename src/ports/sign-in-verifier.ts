/**
 * SignInVerifier -- the seam that turns a raw sign-in assertion (a Cloudflare
 * Access JWT in production, the local issuer's in development and tests) into
 * a Sign-in, or a Refusal. The trusted issuers are passed per call because
 * they belong to the Organization the request is for, not to the verifier.
 * An implementation checks the signature and then applies the domain's
 * Trusted sign-in rules; it never contacts an issuer the list does not name.
 */

import type { Refusal } from '../domain/refusal.js';
import type { SignIn, TrustedIssuer } from '../domain/signin/sign-in.js';

export interface SignInVerifier {
  verify(assertion: string, trusted: readonly TrustedIssuer[]): Promise<SignIn | Refusal>;
}
