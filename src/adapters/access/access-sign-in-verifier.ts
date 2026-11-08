/**
 * AccessSignInVerifier -- the SignInVerifier for Cloudflare Access JWTs (and
 * the local issuer, which mints the same shape). It refuses an assertion whose
 * issuer is not trusted before fetching any key, checks the RS256 signature
 * against that issuer's keys, then hands the claims to the domain's Trusted
 * sign-in rules. Key-selection functions are cached per issuer, so each
 * issuer's JWKS is fetched once and refreshed by jose's own cache rules.
 */

import { compactVerify, decodeJwt, type CompactVerifyGetKey } from 'jose';
import { refusal, type Refusal } from '../../domain/refusal.js';
import { checkClaims, trustedIssuerFor, type AssertionClaims, type SignIn, type TrustedIssuer } from '../../domain/signin/sign-in.js';
import type { SignInVerifier } from '../../ports/sign-in-verifier.js';
import type { KeySource } from './key-source.js';

const ALGORITHMS = ['RS256'];
const UNVERIFIED = refusal('unverified-sign-in');

// --- helpers ---

function unverifiedClaims(assertion: string): AssertionClaims | null {
  try {
    return decodeJwt(assertion);
  } catch {
    return null;
  }
}

function parseClaims(payload: Uint8Array): AssertionClaims | null {
  try {
    const claims: unknown = JSON.parse(new TextDecoder().decode(payload));
    return typeof claims === 'object' && claims !== null ? (claims as AssertionClaims) : null;
  } catch {
    return null;
  }
}

// --- exports ---

export class AccessSignInVerifier implements SignInVerifier {
  readonly #keys: KeySource;
  readonly #clock: { now(): Date };
  readonly #keysByIssuer = new Map<string, CompactVerifyGetKey>();

  constructor(options: { keys: KeySource; clock: { now(): Date } }) {
    this.#keys = options.keys;
    this.#clock = options.clock;
  }

  async verify(assertion: string, trusted: readonly TrustedIssuer[]): Promise<SignIn | Refusal> {
    const unverified = unverifiedClaims(assertion);
    if (!unverified) return UNVERIFIED;
    const issuer = trustedIssuerFor(unverified['iss'], trusted);
    if (!issuer) return refusal('untrusted-issuer');
    const payload = await this.#signedPayload(assertion, issuer.issuer);
    const claims = payload ? parseClaims(payload) : null;
    if (!claims) return UNVERIFIED;
    return checkClaims(claims, trusted, this.#clock.now());
  }

  async #signedPayload(assertion: string, issuer: string): Promise<Uint8Array | null> {
    try {
      const { payload } = await compactVerify(assertion, this.#keysFor(issuer), { algorithms: ALGORITHMS });
      return payload;
    } catch {
      return null;
    }
  }

  #keysFor(issuer: string): CompactVerifyGetKey {
    const cached = this.#keysByIssuer.get(issuer);
    if (cached) return cached;
    const keys = this.#keys.keysFor(issuer);
    this.#keysByIssuer.set(issuer, keys);
    return keys;
  }
}
